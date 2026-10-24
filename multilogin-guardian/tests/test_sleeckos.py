import json
import logging
import tempfile
import unittest
import uuid
from datetime import datetime
from pathlib import Path

import requests

from agent import (
    Config,
    ConfigError,
    GuardianDaemon,
    LOGGER_NAME,
    MultiloginAPIError,
    MultiloginClient,
    MultiloginSettings,
    RemoteConfig,
    ReportOutbox,
    ReportValidationError,
    RuleSettings,
    RuntimeRule,
    SleeckosAPIError,
    SleeckosClient,
    SleeckosSettings,
    validate_cycle_report,
)


MULTILOGIN_TOKEN = "multilogin-test-token"
GUARDIAN_SECRET = "guardian-test-secret"


def raw_config(sleeckos=None):
    value = {
        "multilogin": {
            "base_url": "https://api.multilogin.com",
            "automation_token": MULTILOGIN_TOKEN,
            "check_interval_seconds": 60,
            "batch_size": 50,
        },
        "rules": {
            "by_tag": {
                "political": {"max_runtime_minutes": 10, "description": "Political"}
            },
            "default": {"max_runtime_minutes": 10, "description": "Fallback"},
        },
        "logging": {
            "level": "INFO",
            "file": "logs/guardian.log",
            "max_bytes": 10485760,
            "backup_count": 1,
            "console": False,
        },
        "notifications": {
            "enabled": False,
            "webhook_url": "",
            "notify_on_stop": True,
            "notify_on_error": True,
        },
    }
    if sleeckos is not None:
        value["sleeckos"] = sleeckos
    return value


def integration_config(**overrides):
    value = {
        "enabled": True,
        "base_url": "http://sleeckos.test",
        "shared_secret": GUARDIAN_SECRET,
        "timeout_seconds": 15,
        "report_outbox": "state/reports.jsonl",
        "remote_config_cache": "state/remote-config.json",
    }
    value.update(overrides)
    return value


def remote_config(enforcement=True, interval=7, limit=2, version="remote-v1"):
    return RemoteConfig(
        enforcement_enabled=enforcement,
        check_interval_seconds=interval,
        rules=RuleSettings(
            by_tag={"remote": RuntimeRule(limit, "Remote tag")},
            default=RuntimeRule(limit, "Remote default"),
        ),
        config_version=version,
    )


def cycle_report(cycle_id, error=None):
    report = {
        "cycleId": cycle_id,
        "startedAt": "2026-01-01T00:00:00.000Z",
        "finishedAt": "2026-01-01T00:00:01.000Z",
        "status": "success",
        "inventoryComplete": True,
        "runningCount": 0,
        "stopRequested": 0,
        "stopSucceeded": 0,
        "stopFailed": 0,
        "stopUnknown": 0,
        "profiles": [],
        "stops": [],
    }
    if error is not None:
        report["error"] = error
    return report


class ConfigIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "config.json"

    def tearDown(self):
        self.temp.cleanup()

    def load(self, value):
        self.path.write_text(json.dumps(value), encoding="utf-8")
        return Config.load(self.path)

    def test_absent_section_is_disabled_with_defaults(self):
        config = self.load(raw_config())
        self.assertFalse(config.sleeckos.enabled)
        self.assertEqual(config.sleeckos.base_url, "http://127.0.0.1:3000")
        self.assertEqual(config.sleeckos.timeout_seconds, 15)
        self.assertEqual(
            config.sleeckos.report_outbox,
            str((Path(self.temp.name) / "state" / "reports.jsonl").resolve()),
        )
        self.assertEqual(
            config.sleeckos.remote_config_cache,
            str((Path(self.temp.name) / "state" / "remote-config.json").resolve()),
        )

    def test_enabled_integration_requires_a_real_secret(self):
        for secret in ("", "replace_with_guardian_integration_secret", "replace_me"):
            with self.subTest(secret=secret):
                with self.assertRaisesRegex(ConfigError, "sleeckos.shared_secret"):
                    self.load(raw_config(integration_config(shared_secret=secret)))

    def test_custom_relative_paths_resolve_beside_config(self):
        config = self.load(
            raw_config(
                integration_config(
                    report_outbox="custom/outbox.jsonl",
                    remote_config_cache="custom/cache.json",
                )
            )
        )
        self.assertEqual(
            config.sleeckos.report_outbox,
            str((Path(self.temp.name) / "custom" / "outbox.jsonl").resolve()),
        )
        self.assertEqual(
            config.sleeckos.remote_config_cache,
            str((Path(self.temp.name) / "custom" / "cache.json").resolve()),
        )


class FakeResponse:
    def __init__(self, status_code, payload=None):
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
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def close(self):
        self.closed = True


class SleeckosClientTests(unittest.TestCase):
    def make_client(self, responses):
        client = SleeckosClient(
            SleeckosSettings(
                enabled=True,
                base_url="http://sleeckos.test",
                shared_secret=GUARDIAN_SECRET,
                timeout_seconds=15,
            )
        )
        headers = dict(client.session.headers)
        client.session.close()
        client.session = FakeSession(responses)
        client.session.headers.update(headers)
        return client

    def test_fetches_config_with_secret_header_and_timeout(self):
        client = self.make_client(
            [
                FakeResponse(
                    200,
                    {
                        "enforcementEnabled": False,
                        "checkIntervalSeconds": 12,
                        "rules": {
                            "by_tag": {
                                "Remote": {"max_runtime_minutes": 3, "description": "Remote"}
                            },
                            "default": {"max_runtime_minutes": 4},
                        },
                        "configVersion": "v9",
                    },
                )
            ]
        )
        config = client.fetch_config()
        self.assertFalse(config.enforcement_enabled)
        self.assertEqual(config.check_interval_seconds, 12)
        self.assertEqual(config.rules.by_tag["remote"].max_runtime_minutes, 3)
        self.assertEqual(config.config_version, "v9")
        method, url, kwargs = client.session.calls[0]
        self.assertEqual(method, "GET")
        self.assertEqual(
            url, "http://sleeckos.test/api/internal/multilogin-guardian/config"
        )
        self.assertEqual(kwargs["timeout"], 15)
        self.assertEqual(client.session.headers["x-guardian-secret"], GUARDIAN_SECRET)

    def test_posts_report_to_events_endpoint(self):
        client = self.make_client([FakeResponse(204)])
        report = cycle_report("cycle-1")
        client.send_report(report)
        method, url, kwargs = client.session.calls[0]
        self.assertEqual(method, "POST")
        self.assertEqual(
            url, "http://sleeckos.test/api/internal/multilogin-guardian/events"
        )
        self.assertEqual(kwargs["json"], report)
        self.assertEqual(kwargs["timeout"], 15)

    def test_transport_http_and_validation_errors_hide_secret(self):
        cases = [
            [requests.ConnectionError("could not send %s" % GUARDIAN_SECRET)],
            [FakeResponse(500, {"message": GUARDIAN_SECRET})],
            [
                FakeResponse(
                    200,
                    {
                        "enforcementEnabled": True,
                        "checkIntervalSeconds": 10,
                        "rules": {
                            "by_tag": {
                                GUARDIAN_SECRET: {"max_runtime_minutes": 0}
                            },
                            "default": {"max_runtime_minutes": 10},
                        },
                        "configVersion": "bad",
                    },
                )
            ],
        ]
        for responses in cases:
            with self.subTest(response=type(responses[0]).__name__):
                client = self.make_client(responses)
                with self.assertRaises(SleeckosAPIError) as caught:
                    client.fetch_config()
                self.assertNotIn(GUARDIAN_SECRET, str(caught.exception))


class FakeMultilogin:
    def __init__(self, profiles=None, statuses=None, stop_response=None, list_error=None):
        self.profiles = list(profiles or [])
        self.statuses = dict(statuses or {})
        self.stop_response = stop_response
        self.list_error = list_error
        self.list_calls = 0
        self.status_calls = []
        self.stop_calls = []
        self.closed = False

    def list_running_profiles(self):
        self.list_calls += 1
        if self.list_error is not None:
            raise self.list_error
        return list(self.profiles)

    def get_statuses(self, ids):
        self.status_calls.append(list(ids))
        return {
            "data": {
                "success_details": [
                    self.statuses[profile_id]
                    for profile_id in ids
                    if profile_id in self.statuses
                ],
                "fail_details": [],
            }
        }

    def stop_profiles(self, ids):
        self.stop_calls.append(list(ids))
        if isinstance(self.stop_response, Exception):
            raise self.stop_response
        if self.stop_response is not None:
            return self.stop_response
        return {
            "data": {
                "success_amount": len(ids),
                "fail_amount": 0,
                "fail_details": [],
            }
        }

    def close(self):
        self.closed = True


class FakeNotifier:
    def __init__(self):
        self.errors = []
        self.stops = []
        self.closed = False

    def notify_error(self, message):
        self.errors.append(message)

    def notify_stop(self, profiles, succeeded, failed):
        self.stops.append((list(profiles), succeeded, failed))

    def close(self):
        self.closed = True


class FakeSleeckos:
    def __init__(self, configs=None, send_results=None):
        self.configs = list(configs or [remote_config()])
        self.send_results = list(send_results or [])
        self.fetch_calls = 0
        self.attempts = []
        self.sent = []
        self.closed = False

    def fetch_config(self):
        self.fetch_calls += 1
        result = self.configs.pop(0) if len(self.configs) > 1 else self.configs[0]
        if isinstance(result, Exception):
            raise result
        return result

    def send_report(self, report):
        self.attempts.append(report)
        result = self.send_results.pop(0) if self.send_results else None
        if isinstance(result, Exception):
            raise result
        self.sent.append(report)

    def close(self):
        self.closed = True


class GuardianIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.config_path = self.root / "config.json"
        self.config_path.write_text(
            json.dumps(raw_config(integration_config())), encoding="utf-8"
        )
        self.config = Config.load(self.config_path)
        self.daemons = []

    def tearDown(self):
        for daemon in self.daemons:
            daemon.client.close()
            daemon.notifier.close()
            if daemon.sleeckos_client is not None:
                daemon.sleeckos_client.close()
        logger = logging.getLogger(LOGGER_NAME)
        for handler in list(logger.handlers):
            logger.removeHandler(handler)
            handler.close()
        self.temp.cleanup()

    def make_daemon(self, multilogin, sleeckos, config=None):
        daemon = GuardianDaemon(
            config or self.config,
            config_path=self.config_path,
            client=multilogin,
            notifier=FakeNotifier(),
            sleeckos_client=sleeckos,
        )
        self.daemons.append(daemon)
        return daemon

    def over_limit_profile(self, profile_id="p1", runtime=600):
        profile = {"id": profile_id, "serial_name": profile_id, "tags": ["remote"]}
        status = {"id": profile_id, "status": 0, "running_time_secs": runtime}
        return profile, status

    def real_multilogin(self, profile, status, stop_response):
        client = MultiloginClient(
            MultiloginSettings(
                base_url="https://api.multilogin.com",
                automation_token=MULTILOGIN_TOKEN,
                check_interval_seconds=60,
                batch_size=50,
            )
        )
        client.session.close()
        client.session = FakeSession(
            [
                FakeResponse(200, {"data": {"items": [profile]}}),
                FakeResponse(
                    200,
                    {"data": {"success_details": [status], "fail_details": []}},
                ),
                stop_response,
            ]
        )
        return client

    def test_disabled_enforcement_statuses_and_reports_but_never_stops(self):
        profile, status = self.over_limit_profile()
        multilogin = FakeMultilogin([profile], {profile["id"]: status})
        sleeckos = FakeSleeckos([remote_config(enforcement=False, interval=5, limit=1)])
        daemon = self.make_daemon(multilogin, sleeckos)
        result = daemon.run_cycle()
        self.assertEqual(multilogin.status_calls, [["p1"]])
        self.assertEqual(multilogin.stop_calls, [])
        self.assertEqual(result["stop_requested"], 0)
        self.assertEqual(daemon.check_interval_seconds, 5)
        report = daemon.last_cycle_report
        self.assertEqual(report["status"], "success")
        self.assertEqual(report["profiles"][0]["decision"], "disabled")
        self.assertEqual(report["profiles"][0]["matchedTag"], "remote")
        self.assertEqual(report["stopRequested"], 0)
        self.assertEqual(len(sleeckos.attempts), 1)

    def test_remote_rules_interval_and_cache_are_applied(self):
        profile, status = self.over_limit_profile(runtime=120)
        multilogin = FakeMultilogin([profile], {profile["id"]: status})
        sleeckos = FakeSleeckos([remote_config(interval=9, limit=2, version="v22")])
        daemon = self.make_daemon(multilogin, sleeckos)
        result = daemon.run_cycle()
        self.assertEqual(multilogin.stop_calls, [["p1"]])
        self.assertEqual(result["stopped"], 1)
        self.assertEqual(daemon.check_interval_seconds, 9)
        self.assertEqual(daemon.remote_config_version, "v22")
        self.assertEqual(daemon.last_cycle_report["profiles"][0]["limitMinutes"], 2)
        self.assertEqual(daemon.last_cycle_report["stopSucceeded"], 1)
        cache = json.loads(Path(self.config.sleeckos.remote_config_cache).read_text())
        self.assertEqual(cache["configVersion"], "v22")
        self.assertNotIn(GUARDIAN_SECRET, json.dumps(cache))

    def test_remote_changes_apply_on_the_next_cycle_without_reload(self):
        profile, status = self.over_limit_profile(runtime=120)
        multilogin = FakeMultilogin([profile], {profile["id"]: status})
        sleeckos = FakeSleeckos(
            [
                remote_config(enforcement=True, interval=4, limit=2, version="v1"),
                remote_config(enforcement=False, interval=11, limit=2, version="v2"),
            ]
        )
        daemon = self.make_daemon(multilogin, sleeckos)
        daemon.run_cycle()
        self.assertEqual(multilogin.stop_calls, [["p1"]])
        daemon.run_cycle()
        self.assertEqual(multilogin.stop_calls, [["p1"]])
        self.assertEqual(multilogin.status_calls, [["p1"], ["p1"]])
        self.assertEqual(sleeckos.fetch_calls, 2)
        self.assertEqual(daemon.check_interval_seconds, 11)
        self.assertEqual(daemon.remote_config_version, "v2")
        self.assertEqual(daemon.last_cycle_report["profiles"][0]["decision"], "disabled")

    def test_fetch_failure_uses_disk_cache_across_daemon_instances(self):
        first_multilogin = FakeMultilogin()
        first_sleeckos = FakeSleeckos([remote_config(limit=1, version="cached-v1")])
        first = self.make_daemon(first_multilogin, first_sleeckos)
        first.run_cycle()
        self.assertTrue(Path(self.config.sleeckos.remote_config_cache).exists())

        profile, status = self.over_limit_profile(runtime=60)
        second_multilogin = FakeMultilogin([profile], {profile["id"]: status})
        second_sleeckos = FakeSleeckos(
            [requests.ConnectionError("fetch rejected %s" % GUARDIAN_SECRET)]
        )
        second = self.make_daemon(second_multilogin, second_sleeckos)
        second.run_cycle()
        self.assertEqual(second_multilogin.stop_calls, [["p1"]])
        self.assertEqual(second.remote_config_version, "cached-v1")
        self.assertTrue(second.notifier.errors)
        self.assertNotIn(GUARDIAN_SECRET, "\n".join(second.notifier.errors))

    def test_fetch_failure_without_cache_fails_closed_with_local_rules(self):
        profile, status = self.over_limit_profile(runtime=600)
        profile["tags"] = ["political"]
        status["id"] = profile["id"]
        multilogin = FakeMultilogin([profile], {profile["id"]: status})
        sleeckos = FakeSleeckos([requests.ConnectionError("offline")])
        daemon = self.make_daemon(multilogin, sleeckos)
        daemon.run_cycle()
        self.assertEqual(multilogin.stop_calls, [])
        self.assertFalse(daemon.enforcement_enabled)
        self.assertEqual(daemon.check_interval_seconds, 60)
        self.assertIsNone(daemon.remote_config_version)
        self.assertEqual(daemon.last_cycle_report["profiles"][0]["limitMinutes"], 10)
        self.assertEqual(daemon.last_cycle_report["profiles"][0]["decision"], "disabled")

    def test_empty_cycle_has_complete_structured_report(self):
        multilogin = FakeMultilogin()
        sleeckos = FakeSleeckos()
        daemon = self.make_daemon(multilogin, sleeckos)
        result = daemon.run_cycle()
        report = daemon.last_cycle_report
        self.assertEqual(result["running"], 0)
        self.assertEqual(report["status"], "success")
        self.assertTrue(report["inventoryComplete"])
        self.assertEqual(report["runningCount"], 0)
        self.assertEqual(report["profiles"], [])
        self.assertEqual(report["stops"], [])
        self.assertEqual(str(uuid.UUID(report["cycleId"])), report["cycleId"])
        for key in ("startedAt", "finishedAt"):
            parsed = datetime.strptime(report[key], "%Y-%m-%dT%H:%M:%S.%fZ")
            self.assertIsNotNone(parsed)
        self.assertGreaterEqual(report["finishedAt"], report["startedAt"])
        self.assertEqual(sleeckos.attempts, [report])
        self.assertEqual(daemon.outbox.pending_count, 0)

    def test_inventory_failure_sends_error_report_without_phone_actions(self):
        error = MultiloginAPIError(
            "list failed with %s and %s" % (MULTILOGIN_TOKEN, GUARDIAN_SECRET)
        )
        multilogin = FakeMultilogin(list_error=error)
        sleeckos = FakeSleeckos()
        daemon = self.make_daemon(multilogin, sleeckos)
        result = daemon.run_cycle()
        report = daemon.last_cycle_report
        self.assertEqual(multilogin.status_calls, [])
        self.assertEqual(multilogin.stop_calls, [])
        self.assertEqual(result["running"], 0)
        self.assertEqual(report["status"], "error")
        self.assertFalse(report["inventoryComplete"])
        self.assertEqual(report["runningCount"], 0)
        self.assertEqual(report["profiles"], [])
        self.assertEqual(report["stops"], [])
        self.assertIn("[redacted]", report["error"])
        self.assertNotIn(MULTILOGIN_TOKEN, report["error"])
        self.assertNotIn(GUARDIAN_SECRET, report["error"])
        self.assertEqual(len(sleeckos.attempts), 1)

    def test_ambiguous_stop_counts_produce_unknown_per_profile_results(self):
        first, first_status = self.over_limit_profile("p1", 120)
        second, second_status = self.over_limit_profile("p2", 120)
        multilogin = FakeMultilogin(
            [first, second],
            {"p1": first_status, "p2": second_status},
            stop_response={
                "data": {"success_amount": 0, "fail_amount": 0, "fail_details": []}
            },
        )
        daemon = self.make_daemon(multilogin, FakeSleeckos([remote_config(limit=2)]))
        result = daemon.run_cycle()
        report = daemon.last_cycle_report
        self.assertEqual(result["stop_unknown"], 2)
        self.assertEqual(report["stopUnknown"], 2)
        self.assertEqual(report["stopSucceeded"], 0)
        self.assertEqual(report["stopFailed"], 0)
        self.assertEqual([stop["result"] for stop in report["stops"]], ["unknown", "unknown"])
        self.assertEqual(report["status"], "partial")

    def test_fail_amount_without_fail_details_is_not_definitive_failure(self):
        profile, status = self.over_limit_profile(runtime=120)
        multilogin = FakeMultilogin(
            [profile],
            {profile["id"]: status},
            stop_response={
                "data": {"success_amount": 0, "fail_amount": 1, "fail_details": []}
            },
        )
        daemon = self.make_daemon(multilogin, FakeSleeckos([remote_config(limit=2)]))
        result = daemon.run_cycle()
        report = daemon.last_cycle_report
        self.assertEqual(result["stop_failed"], 1)
        self.assertEqual(result["stop_unknown"], 1)
        self.assertEqual(report["stopFailed"], 0)
        self.assertEqual(report["stopUnknown"], 1)
        self.assertEqual(report["stops"][0]["result"], "unknown")

    def test_explicit_stop_rejection_has_failed_result_and_sanitized_error(self):
        profile, status = self.over_limit_profile(runtime=120)
        multilogin = FakeMultilogin(
            [profile],
            {profile["id"]: status},
            stop_response=MultiloginAPIError(
                "stop failed for %s" % GUARDIAN_SECRET, status_code=422
            ),
        )
        daemon = self.make_daemon(multilogin, FakeSleeckos([remote_config(limit=2)]))
        result = daemon.run_cycle()
        report = daemon.last_cycle_report
        self.assertEqual(result["stop_failed"], 1)
        self.assertEqual(report["stopFailed"], 1)
        self.assertEqual(report["stops"][0]["result"], "failed")
        self.assertNotIn(GUARDIAN_SECRET, report["stops"][0]["error"])
        self.assertIn("[redacted]", report["stops"][0]["error"])
        self.assertEqual(report["status"], "partial")

    def test_real_stop_timeout_is_unknown_and_has_attempt_timestamp(self):
        profile, status = self.over_limit_profile(runtime=120)
        multilogin = MultiloginClient(
            MultiloginSettings(
                base_url="https://api.multilogin.com",
                automation_token=MULTILOGIN_TOKEN,
                check_interval_seconds=60,
                batch_size=50,
            )
        )
        multilogin.session.close()
        multilogin.session = FakeSession(
            [
                FakeResponse(200, {"data": {"items": [profile]}}),
                FakeResponse(
                    200,
                    {"data": {"success_details": [status], "fail_details": []}},
                ),
                requests.Timeout("stop timed out after secret %s" % GUARDIAN_SECRET),
            ]
        )
        daemon = self.make_daemon(multilogin, FakeSleeckos([remote_config(limit=2)]))
        result = daemon.run_cycle()
        report = daemon.last_cycle_report
        stop = report["stops"][0]
        self.assertEqual(result["stop_failed"], 0)
        self.assertEqual(result["stop_unknown"], 1)
        self.assertEqual(report["stopFailed"], 0)
        self.assertEqual(report["stopUnknown"], 1)
        self.assertEqual(stop["result"], "unknown")
        self.assertNotIn(GUARDIAN_SECRET, stop["error"])
        datetime.strptime(stop["occurredAt"], "%Y-%m-%dT%H:%M:%S.%fZ")
        self.assertGreaterEqual(stop["occurredAt"], report["startedAt"])
        self.assertLessEqual(stop["occurredAt"], report["finishedAt"])
        validate_cycle_report(report)

    def test_non_json_http_200_stop_response_is_unknown(self):
        profile, status = self.over_limit_profile(runtime=120)
        multilogin = self.real_multilogin(
            profile, status, FakeResponse(200, ValueError("not JSON"))
        )
        daemon = self.make_daemon(multilogin, FakeSleeckos([remote_config(limit=2)]))
        result = daemon.run_cycle()
        report = daemon.last_cycle_report
        self.assertEqual(result["stop_failed"], 0)
        self.assertEqual(result["stop_unknown"], 1)
        self.assertEqual(report["stops"][0]["result"], "unknown")
        self.assertIn("non-JSON", report["stops"][0]["error"])
        validate_cycle_report(report)

    def test_http_5xx_408_and_429_stop_responses_are_unknown(self):
        for status_code in (408, 429, 500):
            with self.subTest(status_code=status_code):
                profile, status = self.over_limit_profile(runtime=120)
                multilogin = self.real_multilogin(
                    profile,
                    status,
                    FakeResponse(status_code, {"message": "ambiguous stop response"}),
                )
                daemon = self.make_daemon(
                    multilogin, FakeSleeckos([remote_config(limit=2)])
                )
                result = daemon.run_cycle()
                report = daemon.last_cycle_report
                self.assertEqual(result["stop_failed"], 0)
                self.assertEqual(result["stop_unknown"], 1)
                self.assertEqual(report["stopFailed"], 0)
                self.assertEqual(report["stopUnknown"], 1)
                self.assertEqual(report["stops"][0]["result"], "unknown")
                validate_cycle_report(report)

    def test_invalid_profile_values_are_sanitized_or_omitted(self):
        empty_id = {"id": "", "serial_name": "empty", "tags": []}
        negative, negative_status = self.over_limit_profile("negative", -1)
        negative["serial_name"] = "n" * 5000
        negative["tags"] = ["t" * 150] + ["tag"] * 60
        nonfinite, nonfinite_status = self.over_limit_profile("nonfinite", float("nan"))
        multilogin = FakeMultilogin(
            [empty_id, negative, nonfinite],
            {"negative": negative_status, "nonfinite": nonfinite_status},
        )
        sleeckos = FakeSleeckos([remote_config(enforcement=False)])
        daemon = self.make_daemon(multilogin, sleeckos)
        daemon.run_cycle()
        report = daemon.last_cycle_report
        self.assertEqual(multilogin.status_calls, [["negative", "nonfinite"]])
        self.assertEqual(multilogin.stop_calls, [])
        self.assertEqual(report["runningCount"], 3)
        self.assertEqual(len(report["profiles"]), 2)
        self.assertNotIn("", [profile["profileId"] for profile in report["profiles"]])
        self.assertFalse(report["inventoryComplete"])
        self.assertEqual(report["status"], "partial")
        self.assertIn("invalid or empty IDs", report["error"])
        self.assertIn("Sanitized invalid or oversized values", report["error"])
        for profile_report in report["profiles"]:
            self.assertIsNone(profile_report["runningTimeSecs"])
            self.assertEqual(profile_report["decision"], "disabled")
            self.assertLessEqual(len(profile_report["name"]), 255)
            self.assertLessEqual(len(profile_report["tags"]), 50)
            for tag in profile_report["tags"]:
                self.assertLessEqual(len(tag), 100)
        validate_cycle_report(report)
        self.assertEqual(sleeckos.attempts, [report])

    def test_non_bmp_strings_use_utf16_limits_without_splitting_emoji(self):
        emoji = "\U0001F600"
        profile, status = self.over_limit_profile(runtime=120)
        profile["serial_name"] = "a" + emoji * 200
        profile["tags"] = [emoji * 60]
        multilogin = FakeMultilogin([profile], {profile["id"]: status})
        sleeckos = FakeSleeckos([remote_config(enforcement=False)])
        daemon = self.make_daemon(multilogin, sleeckos)
        daemon.run_cycle()
        report = daemon.last_cycle_report
        profile_report = report["profiles"][0]
        self.assertEqual(profile_report["name"], "a" + emoji * 127)
        self.assertEqual(profile_report["tags"], [emoji * 50])
        self.assertEqual(len(profile_report["name"].encode("utf-16-le")) // 2, 255)
        self.assertEqual(len(profile_report["tags"][0].encode("utf-16-le")) // 2, 100)
        profile_report["name"].encode("utf-8", errors="strict")
        self.assertEqual(report["status"], "partial")
        validate_cycle_report(report)

    def test_profile_and_stop_rows_are_capped_at_five_thousand(self):
        profiles = []
        statuses = {}
        for index in range(5001):
            profile, status = self.over_limit_profile("p%d" % index, 120)
            profiles.append(profile)
            statuses[profile["id"]] = status
        multilogin = FakeMultilogin(profiles, statuses)
        sleeckos = FakeSleeckos([remote_config(limit=2)])
        daemon = self.make_daemon(multilogin, sleeckos)
        result = daemon.run_cycle()
        report = daemon.last_cycle_report
        self.assertEqual(len(report["profiles"]), 5000)
        self.assertEqual(len(report["stops"]), 5000)
        self.assertEqual(report["runningCount"], 5001)
        self.assertEqual(report["stopRequested"], 5001)
        self.assertEqual(report["stopSucceeded"], 5001)
        self.assertEqual(result["stopped"], 5001)
        self.assertFalse(report["inventoryComplete"])
        self.assertEqual(report["status"], "partial")
        self.assertIn("Profile report row cap omitted 1 profile(s)", report["error"])
        self.assertIn("Stop report row cap omitted 1 stop(s)", report["error"])
        validate_cycle_report(report)
        self.assertEqual(sleeckos.attempts, [report])

    def test_profile_construction_error_keeps_inventory_incomplete(self):
        profile, status = self.over_limit_profile(runtime=120)
        multilogin = FakeMultilogin([profile], {profile["id"]: status})
        sleeckos = FakeSleeckos([remote_config(limit=2)])
        daemon = self.make_daemon(multilogin, sleeckos)

        def broken_name(_profile):
            raise RuntimeError("profile construction failed")

        daemon._profile_name = broken_name
        daemon.run_cycle()
        report = daemon.last_cycle_report
        self.assertEqual(report["status"], "error")
        self.assertFalse(report["inventoryComplete"])
        self.assertIn("profile construction failed", report["error"])
        self.assertEqual(multilogin.stop_calls, [])
        self.assertEqual(len(sleeckos.attempts), 1)
        validate_cycle_report(report)

    def test_post_failure_preserves_fifo_and_does_not_stop_monitoring(self):
        multilogin = FakeMultilogin()
        sleeckos = FakeSleeckos(
            send_results=[requests.Timeout("timeout %s" % GUARDIAN_SECRET), None, None]
        )
        daemon = self.make_daemon(multilogin, sleeckos)
        daemon.run_cycle()
        first_id = daemon.last_cycle_report["cycleId"]
        self.assertEqual(daemon.outbox.pending_count, 1)
        daemon.run_cycle()
        second_id = daemon.last_cycle_report["cycleId"]
        self.assertEqual(multilogin.list_calls, 2)
        self.assertEqual(
            [report["cycleId"] for report in sleeckos.attempts],
            [first_id, first_id, second_id],
        )
        self.assertEqual(daemon.outbox.pending_count, 0)
        self.assertNotEqual(first_id, second_id)

    def test_daemon_dead_letters_alerts_and_allows_later_cycles(self):
        multilogin = FakeMultilogin()
        sleeckos = FakeSleeckos(
            send_results=[
                SleeckosAPIError("validation failed", status_code=400),
                None,
            ]
        )
        daemon = self.make_daemon(multilogin, sleeckos)
        daemon.run_cycle()
        first_id = daemon.last_cycle_report["cycleId"]
        self.assertEqual(daemon.outbox.pending_count, 0)
        self.assertTrue(
            any("permanently rejected" in message for message in daemon.notifier.errors)
        )
        daemon.run_cycle()
        second_id = daemon.last_cycle_report["cycleId"]
        self.assertEqual(
            [report["cycleId"] for report in sleeckos.attempts], [first_id, second_id]
        )
        self.assertEqual(multilogin.list_calls, 2)
        dead_text = daemon.outbox.dead_path.read_text(encoding="utf-8")
        self.assertEqual(len(dead_text.splitlines()), 1)
        self.assertIn(first_id, dead_text)

    def test_failed_report_file_and_logs_contain_no_credentials(self):
        error = MultiloginAPIError(
            "inventory failed %s %s" % (MULTILOGIN_TOKEN, GUARDIAN_SECRET)
        )
        multilogin = FakeMultilogin(list_error=error)
        sleeckos = FakeSleeckos(send_results=[requests.ConnectionError("offline")])
        daemon = self.make_daemon(multilogin, sleeckos)
        daemon.run_cycle()
        outbox_text = Path(self.config.sleeckos.report_outbox).read_text(encoding="utf-8")
        log_text = Path(self.config.logging.file).read_text(encoding="utf-8")
        self.assertNotIn(MULTILOGIN_TOKEN, outbox_text)
        self.assertNotIn(GUARDIAN_SECRET, outbox_text)
        self.assertNotIn(MULTILOGIN_TOKEN, log_text)
        self.assertNotIn(GUARDIAN_SECRET, log_text)
        self.assertEqual(daemon.outbox.pending_count, 1)

    def test_local_only_config_does_not_use_integration(self):
        local_path = self.root / "local-config.json"
        local_path.write_text(json.dumps(raw_config()), encoding="utf-8")
        local_config = Config.load(local_path)
        profile, status = self.over_limit_profile(runtime=600)
        profile["tags"] = ["political"]
        multilogin = FakeMultilogin([profile], {profile["id"]: status})
        sleeckos = FakeSleeckos()
        daemon = self.make_daemon(multilogin, sleeckos, config=local_config)
        result = daemon.run_cycle()
        self.assertEqual(result["stopped"], 1)
        self.assertEqual(multilogin.stop_calls, [["p1"]])
        self.assertEqual(sleeckos.fetch_calls, 0)
        self.assertEqual(sleeckos.attempts, [])
        self.assertIsNone(daemon.outbox)
        self.assertFalse((self.root / "state" / "reports.jsonl").exists())


class ReportOutboxTests(unittest.TestCase):
    def test_retry_and_restart_preserve_fifo_and_redact_reports(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reports.jsonl"
            first = cycle_report(
                "cycle-one", "failed with %s and %s" % (MULTILOGIN_TOKEN, GUARDIAN_SECRET)
            )
            outbox = ReportOutbox(
                path, sensitive_values=(MULTILOGIN_TOKEN, GUARDIAN_SECRET)
            )
            outbox.append(first)
            with self.assertRaises(requests.Timeout):
                outbox.flush(
                    lambda _report: (_ for _ in ()).throw(requests.Timeout("timed out"))
                )
            self.assertEqual(outbox.pending_count, 1)
            persisted = path.read_text(encoding="utf-8")
            self.assertNotIn(MULTILOGIN_TOKEN, persisted)
            self.assertNotIn(GUARDIAN_SECRET, persisted)

            restarted = ReportOutbox(
                path, sensitive_values=(MULTILOGIN_TOKEN, GUARDIAN_SECRET)
            )
            restarted.append(cycle_report("cycle-two"))
            delivered = []
            restarted.flush(lambda report: delivered.append(report["cycleId"]))
            self.assertEqual(delivered, ["cycle-one", "cycle-two"])
            self.assertEqual(restarted.pending_count, 0)
            self.assertEqual(path.read_text(encoding="utf-8"), "")

    def test_each_success_leaves_only_unacknowledged_reports(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reports.jsonl"
            outbox = ReportOutbox(path)
            outbox.append(cycle_report("cycle-one"))
            outbox.append(cycle_report("cycle-two"))
            attempts = []

            def deliver(report):
                attempts.append(report["cycleId"])
                if report["cycleId"] == "cycle-two":
                    raise requests.ConnectionError("offline")

            with self.assertRaises(requests.ConnectionError):
                outbox.flush(deliver)
            self.assertEqual(attempts, ["cycle-one", "cycle-two"])
            lines = path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 1)
            self.assertEqual(json.loads(lines[0])["cycleId"], "cycle-two")

    def test_invalid_outgoing_report_is_rejected_before_persistence(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reports.jsonl"
            report = cycle_report("invalid")
            report["runningCount"] = 1
            report["profiles"] = [
                {
                    "profileId": "p1",
                    "name": "phone",
                    "tags": [],
                    "status": 0,
                    "runningTimeSecs": -1,
                    "matchedTag": None,
                    "limitMinutes": 2,
                    "decision": "keep",
                }
            ]
            outbox = ReportOutbox(path)
            with self.assertRaises(ReportValidationError):
                outbox.append(report)
            self.assertFalse(path.exists())

    def test_outbox_validation_counts_non_bmp_characters_as_two_units(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reports.jsonl"
            report = cycle_report("invalid-emoji")
            report["runningCount"] = 1
            report["profiles"] = [
                {
                    "profileId": "p1",
                    "name": "\U0001F600" * 128,
                    "tags": [],
                    "status": 0,
                    "runningTimeSecs": 1,
                    "matchedTag": None,
                    "limitMinutes": 2,
                    "decision": "keep",
                }
            ]
            outbox = ReportOutbox(path)
            with self.assertRaises(ReportValidationError):
                outbox.append(report)
            self.assertFalse(path.exists())

    def test_deterministic_validation_responses_dead_letter_and_continue(self):
        for status_code in (400, 413, 422):
            with self.subTest(status_code=status_code), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / "reports.jsonl"
                outbox = ReportOutbox(path, sensitive_values=(GUARDIAN_SECRET,))
                outbox.append(cycle_report("bad", "error %s" % GUARDIAN_SECRET))
                outbox.append(cycle_report("good"))
                delivered = []
                dead_letters = []

                def send(report):
                    if report["cycleId"] == "bad":
                        raise SleeckosAPIError("invalid report", status_code=status_code)
                    delivered.append(report["cycleId"])

                processed = outbox.flush(
                    send,
                    on_dead_letter=lambda report, _error: dead_letters.append(
                        report["cycleId"]
                    ),
                )
                self.assertEqual(processed, 2)
                self.assertEqual(delivered, ["good"])
                self.assertEqual(dead_letters, ["bad"])
                self.assertEqual(outbox.pending_count, 0)
                dead_records = [
                    json.loads(line)
                    for line in outbox.dead_path.read_text(encoding="utf-8").splitlines()
                ]
                self.assertEqual(len(dead_records), 1)
                self.assertEqual(dead_records[0]["cycleId"], "bad")
                self.assertNotIn(GUARDIAN_SECRET, json.dumps(dead_records))

    def test_auth_server_and_transport_errors_remain_queued(self):
        errors = [
            SleeckosAPIError("unauthorized", status_code=401),
            SleeckosAPIError("server error", status_code=500),
            requests.Timeout("timed out"),
        ]
        for error in errors:
            with self.subTest(error=error), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / "reports.jsonl"
                outbox = ReportOutbox(path)
                outbox.append(cycle_report("retry"))
                with self.assertRaises(type(error)):
                    outbox.flush(lambda _report: (_ for _ in ()).throw(error))
                self.assertEqual(outbox.pending_count, 1)
                self.assertFalse(outbox.dead_path.exists())

    def test_valid_final_record_without_newline_is_repaired_before_append(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reports.jsonl"
            path.write_text(json.dumps(cycle_report("cycle-one")), encoding="utf-8")
            outbox = ReportOutbox(path)
            outbox.append(cycle_report("cycle-two"))
            text = path.read_text(encoding="utf-8")
            self.assertTrue(text.endswith("\n"))
            self.assertEqual(len(text.splitlines()), 2)
            delivered = []
            outbox.flush(lambda report: delivered.append(report["cycleId"]))
            self.assertEqual(delivered, ["cycle-one", "cycle-two"])
            self.assertEqual(outbox.quarantined_on_load, 0)

    def test_truncated_final_record_is_quarantined_and_valid_reports_survive(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reports.jsonl"
            path.write_text(
                json.dumps(cycle_report("cycle-one"))
                + "\n"
                + '{"cycleId":"cut","error":"%s"' % GUARDIAN_SECRET,
                encoding="utf-8",
            )
            outbox = ReportOutbox(path, sensitive_values=(GUARDIAN_SECRET,))
            outbox.append(cycle_report("cycle-two"))
            self.assertEqual(outbox.quarantined_on_load, 1)
            self.assertEqual(outbox.pending_count, 2)
            dead_text = outbox.dead_path.read_text(encoding="utf-8")
            self.assertIn("truncated_tail", dead_text)
            self.assertNotIn(GUARDIAN_SECRET, dead_text)
            delivered = []
            outbox.flush(lambda report: delivered.append(report["cycleId"]))
            self.assertEqual(delivered, ["cycle-one", "cycle-two"])

    def test_torn_multibyte_utf8_tail_preserves_valid_reports_and_allows_append(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reports.jsonl"
            emoji = "\U0001F600"
            valid = cycle_report("cycle-one", "valid " + emoji)
            tail = (
                b'{"cycleId":"cut","error":"'
                + GUARDIAN_SECRET.encode("utf-8")
                + b'","emoji":"'
                + b"\xf0\x9f"
            )
            path.write_bytes(
                (json.dumps(valid, ensure_ascii=False) + "\n").encode("utf-8") + tail
            )
            outbox = ReportOutbox(path, sensitive_values=(GUARDIAN_SECRET,))
            outbox.append(cycle_report("cycle-two"))
            self.assertEqual(outbox.quarantined_on_load, 1)
            self.assertEqual(outbox.pending_count, 2)
            dead_text = outbox.dead_path.read_text(encoding="utf-8")
            self.assertIn("truncated_tail", dead_text)
            self.assertIn("\ufffd", dead_text)
            self.assertNotIn(GUARDIAN_SECRET, dead_text)
            path.read_text(encoding="utf-8")
            delivered = []
            outbox.flush(lambda report: delivered.append(report))
            self.assertEqual(
                [report["cycleId"] for report in delivered], ["cycle-one", "cycle-two"]
            )
            self.assertEqual(delivered[0]["error"], "valid " + emoji)

    def test_malformed_middle_line_does_not_discard_valid_pending_reports(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reports.jsonl"
            path.write_text(
                "\n".join(
                    [
                        json.dumps(cycle_report("cycle-one")),
                        "not-json",
                        json.dumps(cycle_report("cycle-two")),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            outbox = ReportOutbox(path)
            self.assertEqual(outbox.pending_count, 2)
            self.assertEqual(outbox.quarantined_on_load, 1)
            repaired = [json.loads(line) for line in path.read_text().splitlines()]
            self.assertEqual(
                [report["cycleId"] for report in repaired], ["cycle-one", "cycle-two"]
            )
            self.assertIn(
                "malformed_line", outbox.dead_path.read_text(encoding="utf-8")
            )
            outbox.append(cycle_report("cycle-three"))
            delivered = []
            outbox.flush(lambda report: delivered.append(report["cycleId"]))
            self.assertEqual(delivered, ["cycle-one", "cycle-two", "cycle-three"])

    def test_flush_drains_at_most_twenty_reports_per_call(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "reports.jsonl"
            outbox = ReportOutbox(path)
            for index in range(25):
                outbox.append(cycle_report("cycle-%02d" % index))
            delivered = []
            self.assertEqual(
                outbox.flush(lambda report: delivered.append(report["cycleId"])), 20
            )
            self.assertEqual(len(delivered), 20)
            self.assertEqual(outbox.pending_count, 5)
            self.assertEqual(
                outbox.flush(lambda report: delivered.append(report["cycleId"])), 5
            )
            self.assertEqual(len(delivered), 25)
            self.assertEqual(outbox.pending_count, 0)


if __name__ == "__main__":
    unittest.main()
