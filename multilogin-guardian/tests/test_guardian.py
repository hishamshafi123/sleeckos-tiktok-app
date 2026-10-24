import json
import logging
import signal
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

from agent import (
    Config,
    ConfigError,
    GuardianDaemon,
    LoggingSettings,
    LOGGER_NAME,
    MultiloginAPIError,
    MultiloginClient,
    MultiloginSettings,
    NotificationSettings,
    Notifier,
    RuleEngine,
    RuleSettings,
    RuntimeRule,
    configure_logging,
)


def raw_config():
    return {
        "multilogin": {
            "base_url": "https://api.multilogin.com",
            "automation_token": "test-secret-token",
            "check_interval_seconds": 60,
            "batch_size": 50,
        },
        "rules": {
            "by_tag": {
                "political": {"max_runtime_minutes": 10, "description": "Political"},
                "general": {"max_runtime_minutes": 10, "description": "General"},
                "state": {"max_runtime_minutes": 35, "description": "State"},
            },
            "default": {"max_runtime_minutes": 10, "description": "Fallback"},
        },
        "logging": {
            "level": "INFO",
            "file": "logs/guardian.log",
            "max_bytes": 10485760,
            "backup_count": 5,
            "console": False,
        },
        "notifications": {
            "enabled": False,
            "webhook_url": "",
            "notify_on_stop": True,
            "notify_on_error": True,
        },
    }


def settings(batch_size=50):
    return MultiloginSettings(
        base_url="https://api.multilogin.com",
        automation_token="test-secret-token",
        check_interval_seconds=60,
        batch_size=batch_size,
    )


def rules():
    return RuleSettings(
        by_tag={
            "political": RuntimeRule(10, "Political"),
            "general": RuntimeRule(10, "General"),
            "state": RuntimeRule(35, "State"),
        },
        default=RuntimeRule(10, "Fallback"),
    )


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "config.json"

    def tearDown(self):
        self.temp.cleanup()

    def write(self, value):
        self.path.write_text(json.dumps(value), encoding="utf-8")
        return Config.load(self.path)

    def test_loads_valid_config_and_resolves_log_path(self):
        config = self.write(raw_config())
        self.assertEqual(config.multilogin.batch_size, 50)
        self.assertEqual(config.rules.by_tag["state"].max_runtime_minutes, 35)
        self.assertEqual(
            config.logging.file,
            str((Path(self.temp.name) / "logs" / "guardian.log").resolve()),
        )

    def test_rejects_placeholder_token(self):
        raw = raw_config()
        raw["multilogin"]["automation_token"] = "mlx_at_xxxxxxxx"
        with self.assertRaisesRegex(ConfigError, "automation_token"):
            self.write(raw)

    def test_rejects_batch_over_api_limit(self):
        raw = raw_config()
        raw["multilogin"]["batch_size"] = 51
        with self.assertRaisesRegex(ConfigError, "between 1 and 50"):
            self.write(raw)

    def test_rejects_nonpositive_runtime(self):
        raw = raw_config()
        raw["rules"]["default"]["max_runtime_minutes"] = 0
        with self.assertRaisesRegex(ConfigError, "greater than zero"):
            self.write(raw)

    def test_rejects_nonfinite_runtime(self):
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                raw = raw_config()
                raw["rules"]["default"]["max_runtime_minutes"] = value
                with self.assertRaisesRegex(ConfigError, "finite"):
                    self.write(raw)

    def test_rejects_enabled_webhook_without_url(self):
        raw = raw_config()
        raw["notifications"]["enabled"] = True
        with self.assertRaisesRegex(ConfigError, "webhook_url"):
            self.write(raw)


class RuleEngineTests(unittest.TestCase):
    def setUp(self):
        self.engine = RuleEngine(rules())

    def test_first_recognized_tag_wins_and_exact_threshold_stops(self):
        profile = {"tags": ["unknown", "state", "political"]}
        rule, tag = self.engine.match(profile)
        self.assertEqual(tag, "state")
        should_stop, limit, running, _reason = self.engine.evaluate(
            profile, {"status": 0, "running_time_secs": 35 * 60}
        )
        self.assertTrue(should_stop)
        self.assertEqual(limit, 35)
        self.assertEqual(running, 35)

    def test_default_rule_below_and_at_threshold(self):
        profile = {"tags": ["unrecognized"]}
        below = self.engine.evaluate(profile, {"status": 0, "running_time_secs": 599})
        at_limit = self.engine.evaluate(profile, {"status": 0, "running_time_secs": 600})
        self.assertFalse(below[0])
        self.assertTrue(at_limit[0])

    def test_non_running_and_missing_runtime_are_not_stopped(self):
        profile = {"tags": ["political"]}
        starting = self.engine.evaluate(
            profile, {"status": 1, "running_time_secs": 9999}
        )
        missing = self.engine.evaluate(profile, {"status": 0})
        self.assertFalse(starting[0])
        self.assertFalse(missing[0])


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self.payload = payload

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.headers = {}
        self.closed = False

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        if not self.responses:
            raise AssertionError("No fake response queued")
        return self.responses.pop(0)

    def close(self):
        self.closed = True


class MultiloginClientTests(unittest.TestCase):
    def make_client(self, responses):
        client = MultiloginClient(settings())
        client.session.close()
        client.session = FakeSession(responses)
        return client

    def test_list_follows_pagination(self):
        first_page = [{"id": "p%d" % index, "tags": []} for index in range(100)]
        client = self.make_client(
            [
                FakeResponse(200, {"data": {"items": first_page}}),
                FakeResponse(200, {"data": {"items": [{"id": "last", "tags": []}]}}),
            ]
        )
        profiles = client.list_running_profiles()
        self.assertEqual(len(profiles), 101)
        self.assertEqual(profiles[-1]["id"], "last")
        self.assertEqual(client.session.calls[0][2]["params"]["page"], 1)
        self.assertEqual(client.session.calls[1][2]["params"]["page"], 2)
        self.assertEqual(client.session.calls[0][2]["params"]["is_running"], "true")

    def test_rejects_batches_over_50(self):
        client = self.make_client([])
        with self.assertRaisesRegex(ValueError, "50"):
            client.get_statuses(["p"] * 51)
        with self.assertRaisesRegex(ValueError, "50"):
            client.stop_profiles(["p"] * 51)

    def test_401_is_explicit_and_does_not_leak_token(self):
        client = self.make_client(
            [FakeResponse(401, {"message": "invalid test-secret-token"})]
        )
        with self.assertRaises(MultiloginAPIError) as caught:
            client.get_statuses(["p1"])
        self.assertEqual(caught.exception.status_code, 401)
        self.assertIn("automation token", str(caught.exception))
        self.assertNotIn("test-secret-token", str(caught.exception))

    def test_embedded_api_error_is_not_treated_as_success(self):
        client = self.make_client(
            [
                FakeResponse(
                    200,
                    {"status": {"http_code": 503, "message": "temporarily unavailable"}},
                )
            ]
        )
        with self.assertRaises(MultiloginAPIError) as caught:
            client.get_statuses(["p1"])
        self.assertEqual(caught.exception.status_code, 503)
        self.assertIn("temporarily unavailable", str(caught.exception))

    def test_tag_update_sends_full_replacement_list(self):
        client = self.make_client([FakeResponse(200, {"status": {"http_code": 200}})])
        client.update_profile_tags("phone-1", ["state"])
        method, url, kwargs = client.session.calls[0]
        self.assertEqual(method, "PUT")
        self.assertTrue(url.endswith("/mobile_profiles/phone/update"))
        self.assertEqual(kwargs["json"], {"id": "phone-1", "tags": ["state"]})


class FakeClient:
    def __init__(self, profiles, statuses, stop_handler=None, status_error_calls=None):
        self.profiles = profiles
        self.statuses = statuses
        self.stop_handler = stop_handler
        self.status_error_calls = set(status_error_calls or [])
        self.status_calls = []
        self.stop_calls = []
        self.closed = False

    def list_running_profiles(self):
        return list(self.profiles)

    def get_statuses(self, ids):
        self.status_calls.append(list(ids))
        if len(self.status_calls) in self.status_error_calls:
            raise MultiloginAPIError("temporary status failure")
        details = [self.statuses[profile_id] for profile_id in ids if profile_id in self.statuses]
        return {"data": {"success_details": details, "fail_details": []}}

    def stop_profiles(self, ids):
        self.stop_calls.append(list(ids))
        if self.stop_handler:
            return self.stop_handler(ids)
        return {"data": {"success_amount": len(ids), "fail_amount": 0, "fail_details": []}}

    def close(self):
        self.closed = True


class FakeNotifier:
    def __init__(self):
        self.stops = []
        self.errors = []
        self.closed = False

    def notify_stop(self, profiles, succeeded, failed):
        self.stops.append((list(profiles), succeeded, failed))

    def notify_error(self, message):
        self.errors.append(message)

    def close(self):
        self.closed = True


class DaemonTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config_path = Path(self.temp.name) / "config.json"
        self.config_path.write_text(json.dumps(raw_config()), encoding="utf-8")
        self.config = Config.load(self.config_path)
        self.daemons = []

    def tearDown(self):
        for daemon in self.daemons:
            daemon.client.close()
            daemon.notifier.close()
        logger = logging.getLogger(LOGGER_NAME)
        for handler in list(logger.handlers):
            logger.removeHandler(handler)
            handler.close()
        self.temp.cleanup()

    def make_daemon(self, client, notifier=None, batch_size=50, client_factory=None):
        config = self.config
        if batch_size != 50:
            config = Config(
                multilogin=settings(batch_size),
                rules=self.config.rules,
                logging=self.config.logging,
                notifications=self.config.notifications,
            )
        daemon = GuardianDaemon(
            config,
            config_path=self.config_path,
            client=client,
            notifier=notifier or FakeNotifier(),
            client_factory=client_factory or (lambda _settings: client),
            notifier_factory=lambda _settings: FakeNotifier(),
        )
        self.daemons.append(daemon)
        return daemon

    def test_cycle_stops_only_over_limit_status_zero_profiles(self):
        profiles = [
            {"id": "p1", "serial_name": "exact", "tags": ["political"]},
            {"id": "p2", "serial_name": "below", "tags": ["state"]},
            {"id": "p3", "serial_name": "starting", "tags": ["general"]},
            {"id": "p4", "serial_name": "fallback", "tags": []},
            {"id": "p5", "serial_name": "missing", "tags": ["political"]},
            {"id": "p6", "serial_name": "state-limit", "tags": ["state"]},
        ]
        statuses = {
            "p1": {"id": "p1", "status": 0, "running_time_secs": 600},
            "p2": {"id": "p2", "status": 0, "running_time_secs": 2099},
            "p3": {"id": "p3", "status": 1, "running_time_secs": 900},
            "p4": {"id": "p4", "status": 0, "running_time_secs": 601},
            "p6": {"id": "p6", "status": 0, "running_time_secs": 2100},
        }
        client = FakeClient(profiles, statuses)
        daemon = self.make_daemon(client)
        result = daemon.run_cycle()
        self.assertEqual(client.stop_calls, [["p1", "p4", "p6"]])
        self.assertEqual(result["stopped"], 3)
        log_text = Path(self.config.logging.file).read_text(encoding="utf-8")
        self.assertIn("Running profiles: 6", log_text)
        self.assertIn("Tag breakdown:", log_text)
        self.assertIn("PROFILE 'exact'", log_text)
        self.assertIn("WILL STOP 'fallback'", log_text)

    def test_status_and_stop_calls_are_chunked_at_50(self):
        profiles = [
            {"id": "p%d" % index, "serial_name": "phone-%d" % index, "tags": ["political"]}
            for index in range(120)
        ]
        statuses = {
            profile["id"]: {
                "id": profile["id"],
                "status": 0,
                "running_time_secs": 601,
            }
            for profile in profiles
        }
        client = FakeClient(profiles, statuses)
        daemon = self.make_daemon(client)
        result = daemon.run_cycle()
        self.assertEqual([len(call) for call in client.status_calls], [50, 50, 20])
        self.assertEqual([len(call) for call in client.stop_calls], [50, 50, 20])
        self.assertEqual(result["stopped"], 120)

    def test_partial_stop_failure_is_counted_and_notified(self):
        profiles = [
            {"id": "p1", "serial_name": "one", "tags": ["political"]},
            {"id": "p2", "serial_name": "two", "tags": ["political"]},
        ]
        statuses = {
            "p1": {"id": "p1", "status": 0, "running_time_secs": 601},
            "p2": {"id": "p2", "status": 0, "running_time_secs": 601},
        }

        def stop_handler(ids):
            return {
                "data": {
                    "success_amount": 1,
                    "fail_amount": 1,
                    "fail_details": [{"id": "p2", "msg": "busy"}],
                }
            }

        client = FakeClient(profiles, statuses, stop_handler=stop_handler)
        notifier = FakeNotifier()
        daemon = self.make_daemon(client, notifier=notifier)
        result = daemon.run_cycle()
        self.assertEqual(result["stopped"], 1)
        self.assertEqual(result["stop_failed"], 1)
        self.assertEqual(notifier.stops, [(["one"], 1, 1)])

    def test_failed_status_batch_does_not_block_other_batches(self):
        profiles = [
            {"id": "p1", "serial_name": "one", "tags": ["political"]},
            {"id": "p2", "serial_name": "two", "tags": ["political"]},
        ]
        statuses = {
            "p1": {"id": "p1", "status": 0, "running_time_secs": 601},
            "p2": {"id": "p2", "status": 0, "running_time_secs": 601},
        }
        client = FakeClient(profiles, statuses, status_error_calls={1})
        daemon = self.make_daemon(client, batch_size=1)
        result = daemon.run_cycle()
        self.assertEqual(client.stop_calls, [["p2"]])
        self.assertEqual(result["stopped"], 1)

    def test_reload_replaces_rules_client_and_notifier(self):
        old_client = FakeClient([], {})
        replacement_client = FakeClient([], {})
        replacement_notifier = FakeNotifier()
        daemon = self.make_daemon(
            old_client,
            client_factory=lambda _settings: replacement_client,
        )
        daemon._notifier_factory = lambda _settings: replacement_notifier
        updated = raw_config()
        updated["rules"]["by_tag"]["state"]["max_runtime_minutes"] = 45
        self.config_path.write_text(json.dumps(updated), encoding="utf-8")
        daemon.handle_reload_signal(0)
        self.assertTrue(daemon.reload_requested)
        daemon._apply_reload()
        self.assertFalse(daemon.reload_requested)
        self.assertEqual(daemon.rule_engine.settings.by_tag["state"].max_runtime_minutes, 45)
        self.assertIs(daemon.client, replacement_client)
        self.assertIs(daemon.notifier, replacement_notifier)
        self.assertTrue(old_client.closed)

    def test_invalid_reload_keeps_previous_configuration(self):
        client = FakeClient([], {})
        daemon = self.make_daemon(client)
        self.config_path.write_text("{not-json", encoding="utf-8")
        daemon.reload_requested = True
        daemon._apply_reload()
        self.assertIs(daemon.client, client)
        self.assertEqual(daemon.config.rules.default.max_runtime_minutes, 10)
        self.assertFalse(client.closed)

    def test_logging_reload_failure_keeps_previous_state(self):
        old_client = FakeClient([], {})
        old_notifier = FakeNotifier()
        replacement_client = FakeClient([], {})
        replacement_notifier = FakeNotifier()
        daemon = self.make_daemon(
            old_client,
            notifier=old_notifier,
            client_factory=lambda _settings: replacement_client,
        )
        daemon._notifier_factory = lambda _settings: replacement_notifier
        daemon.reload_requested = True
        with patch("agent.configure_logging", side_effect=OSError("read-only filesystem")):
            daemon._apply_reload()
        self.assertIs(daemon.client, old_client)
        self.assertIs(daemon.notifier, old_notifier)
        self.assertIs(daemon.config, self.config)
        self.assertTrue(replacement_client.closed)
        self.assertTrue(replacement_notifier.closed)
        self.assertFalse(old_client.closed)
        self.assertTrue(old_notifier.errors)

    def test_logging_failure_preserves_existing_handlers(self):
        daemon = self.make_daemon(FakeClient([], {}))
        existing_handlers = list(daemon.logger.handlers)
        bad_settings = LoggingSettings(
            level="INFO",
            file=self.temp.name,  # A directory cannot be opened as a log file.
            max_bytes=1024,
            backup_count=1,
            console=False,
        )
        with self.assertRaises(OSError):
            configure_logging(bad_settings)
        self.assertEqual(list(daemon.logger.handlers), existing_handlers)

    def test_stop_signal_prevents_another_cycle_and_wakes_wait(self):
        daemon = self.make_daemon(FakeClient([], {}))
        daemon.handle_stop_signal(0)
        self.assertFalse(daemon.running)
        self.assertTrue(daemon._wake.is_set())

    @unittest.skipUnless(hasattr(signal, "pthread_sigmask"), "requires POSIX signal masks")
    def test_run_blocks_stop_signals_around_active_cycle(self):
        daemon = self.make_daemon(FakeClient([], {}))
        original_mask = signal.pthread_sigmask
        with patch.object(daemon, "install_signal_handlers"), patch.object(
            daemon, "run_cycle", side_effect=lambda: daemon.handle_stop_signal(0)
        ) as cycle, patch("agent.signal.pthread_sigmask", wraps=original_mask) as mask:
            daemon.run()
        self.assertEqual(cycle.call_count, 1)
        self.assertEqual(
            [call.args[0] for call in mask.call_args_list],
            [signal.SIG_BLOCK, signal.SIG_UNBLOCK],
        )

    def test_main_refuses_root(self):
        with patch("agent.os.geteuid", return_value=0):
            with self.assertRaises(SystemExit) as caught:
                from agent import main

                main(["--config", str(self.config_path)])
        self.assertEqual(caught.exception.code, 2)


class NotifierTests(unittest.TestCase):
    def test_webhook_transport_error_does_not_leak_secret_url(self):
        secret_url = "https://hooks.example.test/secret-webhook-token"
        notifier = Notifier(
            NotificationSettings(
                enabled=True,
                webhook_url=secret_url,
                notify_on_stop=True,
                notify_on_error=True,
            )
        )

        class FailingSession:
            def post(self, _url, **_kwargs):
                raise requests.ConnectionError("Could not connect to %s" % secret_url)

        notifier.session.close()
        notifier.session = FailingSession()
        with self.assertLogs(LOGGER_NAME, level="WARNING") as captured:
            notifier.notify_error("cycle failed")
        output = "\n".join(captured.output)
        self.assertIn("ConnectionError", output)
        self.assertNotIn("secret-webhook-token", output)
        self.assertNotIn(secret_url, output)


if __name__ == "__main__":
    unittest.main()
