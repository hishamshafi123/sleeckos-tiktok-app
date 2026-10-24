#!/usr/bin/env python3
"""Multilogin Guardian Agent.

Monitors running Multilogin cloud phones and stops profiles that exceed the
runtime rule selected by their tags. Only the ``requests`` package is required.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import signal
import stat
import sys
import tempfile
import threading
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Sequence, Tuple

import requests


LOGGER_NAME = "multilogin_guardian"
LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
DEFAULT_PAGE_SIZE = 100
DEFAULT_TIMEOUT_SECONDS = 30
DEFAULT_SLEECKOS_BASE_URL = "http://127.0.0.1:3000"
DEFAULT_SLEECKOS_SECRET = "replace_with_guardian_integration_secret"
DEFAULT_SLEECKOS_TIMEOUT_SECONDS = 15
DEFAULT_REPORT_OUTBOX = "state/reports.jsonl"
DEFAULT_REMOTE_CONFIG_CACHE = "state/remote-config.json"
PLACEHOLDER_TOKENS = {"", "mlx_at_xxxxxxxx", "replace_me", "your_token_here"}
PLACEHOLDER_GUARDIAN_SECRETS = PLACEHOLDER_TOKENS | {
    DEFAULT_SLEECKOS_SECRET,
    "replace_with_guardian_integration_secret",
    "your_guardian_secret_here",
}
SLEECKOS_CONFIG_PATH = "/api/internal/multilogin-guardian/config"
SLEECKOS_EVENTS_PATH = "/api/internal/multilogin-guardian/events"
MAX_OUTBOX_FLUSH_PER_CYCLE = 20
DEAD_LETTER_HTTP_STATUSES = {400, 413, 422}
MAX_REPORT_ID_LENGTH = 128
MAX_REPORT_NAME_LENGTH = 255
MAX_REPORT_TAG_LENGTH = 100
MAX_REPORT_TAGS = 50
MAX_REPORT_PROFILES = 5000
MAX_REPORT_STOPS = 5000
MAX_REPORT_ERROR_LENGTH = 4000
MAX_REPORT_TIMESTAMP_LENGTH = 64


class ConfigError(ValueError):
    """Raised when the Guardian configuration is invalid."""


class MultiloginAPIError(RuntimeError):
    """A sanitized Multilogin API or transport failure."""

    def __init__(self, message: str, status_code: Optional[int] = None, path: Optional[str] = None):
        super().__init__(message)
        self.status_code = status_code
        self.path = path


class SleeckosAPIError(RuntimeError):
    """A sanitized SleeckOS API, transport, or payload failure."""

    def __init__(self, message: str, status_code: Optional[int] = None, path: Optional[str] = None):
        super().__init__(message)
        self.status_code = status_code
        self.path = path


class OutboxError(RuntimeError):
    """A durable report outbox failure."""


class ReportValidationError(ValueError):
    """A cycle report cannot be accepted by the SleeckOS contract."""


@dataclass(frozen=True)
class MultiloginSettings:
    base_url: str
    automation_token: str
    check_interval_seconds: float
    batch_size: int


@dataclass(frozen=True)
class RuntimeRule:
    max_runtime_minutes: float
    description: str = ""


@dataclass(frozen=True)
class RuleSettings:
    by_tag: Dict[str, RuntimeRule]
    default: RuntimeRule


@dataclass(frozen=True)
class LoggingSettings:
    level: str
    file: str
    max_bytes: int
    backup_count: int
    console: bool


@dataclass(frozen=True)
class NotificationSettings:
    enabled: bool
    webhook_url: str
    notify_on_stop: bool
    notify_on_error: bool


@dataclass(frozen=True)
class SleeckosSettings:
    enabled: bool = False
    base_url: str = DEFAULT_SLEECKOS_BASE_URL
    shared_secret: str = DEFAULT_SLEECKOS_SECRET
    timeout_seconds: float = DEFAULT_SLEECKOS_TIMEOUT_SECONDS
    report_outbox: str = DEFAULT_REPORT_OUTBOX
    remote_config_cache: str = DEFAULT_REMOTE_CONFIG_CACHE


@dataclass(frozen=True)
class RemoteConfig:
    enforcement_enabled: bool
    check_interval_seconds: float
    rules: RuleSettings
    config_version: str


@dataclass(frozen=True)
class Config:
    multilogin: MultiloginSettings
    rules: RuleSettings
    logging: LoggingSettings
    notifications: NotificationSettings
    sleeckos: SleeckosSettings = field(default_factory=SleeckosSettings)

    @classmethod
    def load(cls, path: os.PathLike) -> "Config":
        config_path = Path(path).expanduser().resolve()
        try:
            with config_path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
        except FileNotFoundError as exc:
            raise ConfigError("Configuration file not found: %s" % config_path) from exc
        except json.JSONDecodeError as exc:
            raise ConfigError(
                "Invalid JSON in %s at line %d, column %d: %s"
                % (config_path, exc.lineno, exc.colno, exc.msg)
            ) from exc
        except OSError as exc:
            raise ConfigError("Cannot read configuration file %s: %s" % (config_path, exc)) from exc

        root = _mapping(raw, "configuration root")
        multilogin_raw = _mapping(root.get("multilogin"), "multilogin")
        rules_raw = _mapping(root.get("rules"), "rules")
        logging_raw = _mapping(root.get("logging", {}), "logging")
        notifications_raw = _mapping(root.get("notifications", {}), "notifications")
        sleeckos_raw = _mapping(root.get("sleeckos", {}), "sleeckos")

        base_url = _string(multilogin_raw.get("base_url"), "multilogin.base_url").rstrip("/")
        if not base_url.startswith(("https://", "http://")):
            raise ConfigError("multilogin.base_url must be an http(s) URL")
        token = _string(
            multilogin_raw.get("automation_token"), "multilogin.automation_token"
        ).strip()
        if token.lower() in PLACEHOLDER_TOKENS:
            raise ConfigError(
                "multilogin.automation_token must be set to a real Multilogin automation token"
            )
        interval = _positive_number(
            multilogin_raw.get("check_interval_seconds", 60),
            "multilogin.check_interval_seconds",
        )
        batch_size = _integer(multilogin_raw.get("batch_size", 50), "multilogin.batch_size")
        if not 1 <= batch_size <= 50:
            raise ConfigError("multilogin.batch_size must be between 1 and 50")

        by_tag_raw = _mapping(rules_raw.get("by_tag", {}), "rules.by_tag")
        by_tag: Dict[str, RuntimeRule] = {}
        for raw_tag, raw_rule in by_tag_raw.items():
            tag = str(raw_tag).strip().lower()
            if not tag:
                raise ConfigError("rules.by_tag cannot contain an empty tag")
            by_tag[tag] = _runtime_rule(raw_rule, "rules.by_tag.%s" % tag)
        default_rule = _runtime_rule(rules_raw.get("default"), "rules.default")

        level = str(logging_raw.get("level", "INFO")).upper()
        if level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ConfigError("logging.level must be DEBUG, INFO, WARNING, ERROR, or CRITICAL")
        log_file = _string(logging_raw.get("file", "logs/guardian.log"), "logging.file")
        log_path = Path(log_file).expanduser()
        if not log_path.is_absolute():
            log_path = config_path.parent / log_path
        max_bytes = _integer(logging_raw.get("max_bytes", 10485760), "logging.max_bytes")
        if max_bytes <= 0:
            raise ConfigError("logging.max_bytes must be greater than zero")
        backup_count = _integer(logging_raw.get("backup_count", 5), "logging.backup_count")
        if backup_count < 0:
            raise ConfigError("logging.backup_count cannot be negative")
        console = _boolean(logging_raw.get("console", True), "logging.console")

        enabled = _boolean(notifications_raw.get("enabled", False), "notifications.enabled")
        webhook_url = str(notifications_raw.get("webhook_url", "")).strip()
        if enabled and not webhook_url.startswith(("https://", "http://")):
            raise ConfigError("notifications.webhook_url must be an http(s) URL when enabled")

        sleeckos_enabled = _boolean(sleeckos_raw.get("enabled", False), "sleeckos.enabled")
        sleeckos_base_url = _string(
            sleeckos_raw.get("base_url", DEFAULT_SLEECKOS_BASE_URL), "sleeckos.base_url"
        ).rstrip("/")
        if not sleeckos_base_url.startswith(("https://", "http://")):
            raise ConfigError("sleeckos.base_url must be an http(s) URL")
        shared_secret = sleeckos_raw.get("shared_secret", DEFAULT_SLEECKOS_SECRET)
        if not isinstance(shared_secret, str):
            raise ConfigError("sleeckos.shared_secret must be a string")
        shared_secret = shared_secret.strip()
        if sleeckos_enabled and shared_secret.lower() in PLACEHOLDER_GUARDIAN_SECRETS:
            raise ConfigError(
                "sleeckos.shared_secret must be set to a real integration secret when enabled"
            )
        sleeckos_timeout = _positive_number(
            sleeckos_raw.get("timeout_seconds", DEFAULT_SLEECKOS_TIMEOUT_SECONDS),
            "sleeckos.timeout_seconds",
        )
        report_outbox = _string(
            sleeckos_raw.get("report_outbox", DEFAULT_REPORT_OUTBOX),
            "sleeckos.report_outbox",
        )
        remote_config_cache = _string(
            sleeckos_raw.get("remote_config_cache", DEFAULT_REMOTE_CONFIG_CACHE),
            "sleeckos.remote_config_cache",
        )

        return cls(
            multilogin=MultiloginSettings(
                base_url=base_url,
                automation_token=token,
                check_interval_seconds=interval,
                batch_size=batch_size,
            ),
            rules=RuleSettings(by_tag=by_tag, default=default_rule),
            logging=LoggingSettings(
                level=level,
                file=str(log_path.resolve()),
                max_bytes=max_bytes,
                backup_count=backup_count,
                console=console,
            ),
            notifications=NotificationSettings(
                enabled=enabled,
                webhook_url=webhook_url,
                notify_on_stop=_boolean(
                    notifications_raw.get("notify_on_stop", True), "notifications.notify_on_stop"
                ),
                notify_on_error=_boolean(
                    notifications_raw.get("notify_on_error", True), "notifications.notify_on_error"
                ),
            ),
            sleeckos=SleeckosSettings(
                enabled=sleeckos_enabled,
                base_url=sleeckos_base_url,
                shared_secret=shared_secret,
                timeout_seconds=sleeckos_timeout,
                report_outbox=str(_config_relative_path(report_outbox, config_path)),
                remote_config_cache=str(_config_relative_path(remote_config_cache, config_path)),
            ),
        )


def _mapping(value: Any, name: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ConfigError("%s must be a JSON object" % name)
    return value


def _string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError("%s must be a non-empty string" % name)
    return value.strip()


def _integer(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConfigError("%s must be an integer" % name)
    return value


def _positive_number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfigError("%s must be a number greater than zero" % name)
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise ConfigError("%s must be a finite number greater than zero" % name)
    return number


def _boolean(value: Any, name: str) -> bool:
    if not isinstance(value, bool):
        raise ConfigError("%s must be true or false" % name)
    return value


def _runtime_rule(value: Any, name: str) -> RuntimeRule:
    raw = _mapping(value, name)
    return RuntimeRule(
        max_runtime_minutes=_positive_number(
            raw.get("max_runtime_minutes"), "%s.max_runtime_minutes" % name
        ),
        description=str(raw.get("description", "")),
    )


def _config_relative_path(value: str, config_path: Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = config_path.parent / path
    return path.resolve()


def _remote_config_from_payload(payload: Any) -> RemoteConfig:
    raw = _mapping(payload, "SleeckOS remote config")
    rules_raw = _mapping(raw.get("rules"), "SleeckOS remote config.rules")
    by_tag_raw = _mapping(rules_raw.get("by_tag", {}), "SleeckOS remote config.rules.by_tag")
    by_tag: Dict[str, RuntimeRule] = {}
    for raw_tag, raw_rule in by_tag_raw.items():
        tag = str(raw_tag).strip().lower()
        if not tag:
            raise ConfigError("SleeckOS remote config.rules.by_tag cannot contain an empty tag")
        by_tag[tag] = _runtime_rule(
            raw_rule, "SleeckOS remote config.rules.by_tag.%s" % tag
        )
    return RemoteConfig(
        enforcement_enabled=_boolean(
            raw.get("enforcementEnabled"), "SleeckOS remote config.enforcementEnabled"
        ),
        check_interval_seconds=_positive_number(
            raw.get("checkIntervalSeconds"), "SleeckOS remote config.checkIntervalSeconds"
        ),
        rules=RuleSettings(
            by_tag=by_tag,
            default=_runtime_rule(
                rules_raw.get("default"), "SleeckOS remote config.rules.default"
            ),
        ),
        config_version=_string(raw.get("configVersion"), "SleeckOS remote config.configVersion"),
    )


def _sync_directory(path: Path) -> None:
    try:
        descriptor = os.open(str(path), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            if hasattr(os, "fchmod"):
                os.fchmod(handle.fileno(), 0o600)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(str(temporary_path), str(path))
        _sync_directory(path.parent)
    except Exception:
        try:
            temporary_path.unlink()
        except OSError:
            pass
        raise


def _atomic_write_json(path: Path, payload: Any) -> None:
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n"
    _atomic_write_text(path, text)


def _utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le", errors="strict")) // 2


def _bounded_report_text(value: Any, maximum: int) -> str:
    text = str(value).encode("utf-8", errors="replace").decode("utf-8")
    units = 0
    result = []
    for character in text:
        character_units = 2 if ord(character) > 0xFFFF else 1
        if units + character_units > maximum:
            break
        result.append(character)
        units += character_units
    return "".join(result)


def _validate_report_string(
    value: Any, name: str, maximum: int, allow_empty: bool = False
) -> None:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise ReportValidationError("%s must be a non-empty string" % name)
    try:
        value.encode("utf-8", errors="strict")
        length = _utf16_length(value)
    except UnicodeError as exc:
        raise ReportValidationError("%s is not valid UTF-8" % name) from exc
    if length > maximum:
        raise ReportValidationError("%s exceeds %d UTF-16 code units" % (name, maximum))


def _validate_report_timestamp(value: Any, name: str) -> None:
    _validate_report_string(value, name, MAX_REPORT_TIMESTAMP_LENGTH)
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except ValueError as exc:
        raise ReportValidationError("%s must be an ISO timestamp" % name) from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ReportValidationError("%s must include a timezone" % name)


def _validate_report_number(
    value: Any, name: str, nullable: bool = True, positive: bool = False
) -> None:
    if value is None and nullable:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ReportValidationError("%s must be a number%s" % (name, " or null" if nullable else ""))
    if not math.isfinite(float(value)):
        raise ReportValidationError("%s must be finite" % name)
    if positive:
        if value <= 0:
            raise ReportValidationError("%s must be greater than zero" % name)
    elif value < 0:
        raise ReportValidationError("%s cannot be negative" % name)


def _validate_report_count(value: Any, name: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ReportValidationError("%s must be a non-negative integer" % name)


def _validate_report_tags(value: Any, name: str) -> None:
    if not isinstance(value, list) or len(value) > MAX_REPORT_TAGS:
        raise ReportValidationError("%s must be a list of at most %d tags" % (name, MAX_REPORT_TAGS))
    for index, tag in enumerate(value):
        _validate_report_string(tag, "%s[%d]" % (name, index), MAX_REPORT_TAG_LENGTH)


def _validate_profile_report(profile: Any, name: str) -> None:
    if not isinstance(profile, dict):
        raise ReportValidationError("%s must be an object" % name)
    required = {
        "profileId",
        "name",
        "tags",
        "status",
        "runningTimeSecs",
        "matchedTag",
        "limitMinutes",
        "decision",
    }
    if not required.issubset(profile):
        raise ReportValidationError("%s is missing required fields" % name)
    _validate_report_string(profile["profileId"], name + ".profileId", MAX_REPORT_ID_LENGTH)
    _validate_report_string(profile["name"], name + ".name", MAX_REPORT_NAME_LENGTH)
    _validate_report_tags(profile["tags"], name + ".tags")
    _validate_report_number(profile["status"], name + ".status")
    _validate_report_number(profile["runningTimeSecs"], name + ".runningTimeSecs")
    if profile["matchedTag"] is not None:
        _validate_report_string(
            profile["matchedTag"], name + ".matchedTag", MAX_REPORT_TAG_LENGTH
        )
    _validate_report_number(
        profile["limitMinutes"], name + ".limitMinutes", positive=True
    )
    if profile["decision"] not in {"keep", "stop", "skip", "disabled"}:
        raise ReportValidationError("%s.decision is invalid" % name)


def _validate_stop_report(stop: Any, name: str) -> None:
    if not isinstance(stop, dict):
        raise ReportValidationError("%s must be an object" % name)
    required = {
        "profileId",
        "name",
        "tags",
        "matchedTag",
        "runtimeSecs",
        "limitMinutes",
        "result",
    }
    if not required.issubset(stop):
        raise ReportValidationError("%s is missing required fields" % name)
    _validate_report_string(stop["profileId"], name + ".profileId", MAX_REPORT_ID_LENGTH)
    _validate_report_string(stop["name"], name + ".name", MAX_REPORT_NAME_LENGTH)
    _validate_report_tags(stop["tags"], name + ".tags")
    if stop["matchedTag"] is not None:
        _validate_report_string(stop["matchedTag"], name + ".matchedTag", MAX_REPORT_TAG_LENGTH)
    _validate_report_number(stop["runtimeSecs"], name + ".runtimeSecs")
    _validate_report_number(stop["limitMinutes"], name + ".limitMinutes", positive=True)
    if stop["result"] not in {"stopped", "failed", "unknown"}:
        raise ReportValidationError("%s.result is invalid" % name)
    if "occurredAt" in stop:
        _validate_report_timestamp(stop["occurredAt"], name + ".occurredAt")
    if "error" in stop:
        _validate_report_string(
            stop["error"], name + ".error", MAX_REPORT_ERROR_LENGTH, allow_empty=True
        )


def validate_cycle_report(report: Any) -> None:
    if not isinstance(report, dict):
        raise ReportValidationError("Cycle report must be an object")
    required = {
        "cycleId",
        "startedAt",
        "finishedAt",
        "status",
        "inventoryComplete",
        "runningCount",
        "stopRequested",
        "stopSucceeded",
        "stopFailed",
        "stopUnknown",
        "profiles",
        "stops",
    }
    if not required.issubset(report):
        raise ReportValidationError("Cycle report is missing required fields")
    _validate_report_string(report["cycleId"], "cycleId", MAX_REPORT_ID_LENGTH)
    _validate_report_timestamp(report["startedAt"], "startedAt")
    _validate_report_timestamp(report["finishedAt"], "finishedAt")
    if report["status"] not in {"success", "partial", "error"}:
        raise ReportValidationError("status is invalid")
    if not isinstance(report["inventoryComplete"], bool):
        raise ReportValidationError("inventoryComplete must be boolean")
    for key in ("runningCount", "stopRequested", "stopSucceeded", "stopFailed", "stopUnknown"):
        _validate_report_count(report[key], key)
    if not isinstance(report["profiles"], list) or not isinstance(report["stops"], list):
        raise ReportValidationError("profiles and stops must be lists")
    if len(report["profiles"]) > MAX_REPORT_PROFILES:
        raise ReportValidationError("profiles exceeds %d rows" % MAX_REPORT_PROFILES)
    if len(report["stops"]) > MAX_REPORT_STOPS:
        raise ReportValidationError("stops exceeds %d rows" % MAX_REPORT_STOPS)
    if report["runningCount"] < len(report["profiles"]):
        raise ReportValidationError("runningCount cannot be smaller than the profile list")
    for index, profile in enumerate(report["profiles"]):
        _validate_profile_report(profile, "profiles[%d]" % index)
    for index, stop in enumerate(report["stops"]):
        _validate_stop_report(stop, "stops[%d]" % index)
    if report["stopRequested"] < len(report["stops"]):
        raise ReportValidationError("stopRequested cannot be smaller than the stop list")
    if report["stopSucceeded"] + report["stopFailed"] + report["stopUnknown"] != report[
        "stopRequested"
    ]:
        raise ReportValidationError("Stop outcome counts must equal stopRequested")
    outcomes = Counter(stop["result"] for stop in report["stops"])
    if (
        report["stopSucceeded"] < outcomes["stopped"]
        or report["stopFailed"] < outcomes["failed"]
        or report["stopUnknown"] < outcomes["unknown"]
    ):
        raise ReportValidationError("Stop outcome counts cannot be smaller than stop entries")
    if "error" in report:
        _validate_report_string(
            report["error"], "error", MAX_REPORT_ERROR_LENGTH, allow_empty=True
        )


class ReportOutbox:
    """Durable FIFO delivery queue for idempotent cycle reports."""

    def __init__(self, path: os.PathLike, sensitive_values: Sequence[str] = ()):
        self.path = Path(path)
        self.dead_path = Path(str(self.path) + ".dead")
        self.sensitive_values = tuple(value for value in sensitive_values if value)
        self._reports: List[Dict[str, Any]] = []
        self._loaded = False
        self.quarantined_on_load = 0

    def _redact(self, value: Any) -> Any:
        if isinstance(value, str):
            for secret in self.sensitive_values:
                value = value.replace(secret, "[redacted]")
            return value
        if isinstance(value, list):
            return [self._redact(item) for item in value]
        if isinstance(value, dict):
            return {self._redact(key): self._redact(item) for key, item in value.items()}
        return value

    def _append_record(self, path: Path, record: Any) -> None:
        safe_record = self._redact(record)
        try:
            line = json.dumps(safe_record, ensure_ascii=False, allow_nan=False) + "\n"
            path.parent.mkdir(parents=True, exist_ok=True)
            flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND
            flags |= getattr(os, "O_NOFOLLOW", 0)
            descriptor = os.open(str(path), flags, 0o600)
            try:
                if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                    raise OutboxError("Outbox path is not a regular file: %s" % path)
                with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                    descriptor = -1
                    handle.write(line)
                    handle.flush()
                    os.fsync(handle.fileno())
            finally:
                if descriptor >= 0:
                    os.close(descriptor)
        except OutboxError:
            raise
        except (OSError, ValueError, TypeError, UnicodeError) as exc:
            raise OutboxError("Cannot append outbox record %s: %s" % (path, exc)) from exc
        _sync_directory(path.parent)

    def _quarantine_line(self, line: str, reason: str) -> None:
        timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
            "+00:00", "Z"
        )
        self._append_record(
            self.dead_path,
            {"quarantinedAt": timestamp, "reason": reason, "raw": line},
        )

    def _quarantine_bytes(self, line: bytes, reason: str) -> None:
        safe_line = line
        for secret in self.sensitive_values:
            safe_line = safe_line.replace(secret.encode("utf-8"), b"[redacted]")
        self._quarantine_line(safe_line.decode("utf-8", errors="replace"), reason)

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        try:
            data = self.path.read_bytes()
        except FileNotFoundError:
            data = b""
        except OSError as exc:
            raise OutboxError("Cannot read report outbox %s: %s" % (self.path, exc)) from exc
        reports: List[Dict[str, Any]] = []
        has_final_line_break = data.endswith((b"\n", b"\r"))
        needs_rewrite = bool(data) and not data.endswith(b"\n")
        quarantined = 0
        lines = data.split(b"\n") if data else []
        if data.endswith(b"\n"):
            lines = lines[:-1]
        for index, raw_line in enumerate(lines):
            if not raw_line.strip():
                needs_rewrite = True
                continue
            try:
                line = raw_line.decode("utf-8", errors="strict")
            except UnicodeDecodeError:
                reason = (
                    "truncated_tail"
                    if index == len(lines) - 1 and not has_final_line_break
                    else "invalid_utf8"
                )
                self._quarantine_bytes(raw_line, reason)
                quarantined += 1
                needs_rewrite = True
                continue
            try:
                report = json.loads(line)
            except (ValueError, RecursionError):
                reason = (
                    "truncated_tail"
                    if index == len(lines) - 1 and not has_final_line_break
                    else "malformed_line"
                )
                self._quarantine_line(line, reason)
                quarantined += 1
                needs_rewrite = True
                continue
            safe_report = self._redact(report)
            try:
                validate_cycle_report(safe_report)
            except ReportValidationError:
                self._quarantine_line(line, "invalid_report")
                quarantined += 1
                needs_rewrite = True
                continue
            reports.append(safe_report)
        self._reports = reports
        if needs_rewrite:
            self._rewrite(reports)
        self.quarantined_on_load = quarantined
        self._loaded = True
        if quarantined:
            logging.getLogger(LOGGER_NAME).warning(
                "Quarantined %d invalid report outbox line(s) to %s",
                quarantined,
                self.dead_path,
            )

    def append(self, report: Dict[str, Any]) -> None:
        safe_report = self._redact(report)
        validate_cycle_report(safe_report)
        self._ensure_loaded()
        self._append_record(self.path, safe_report)
        self._reports.append(safe_report)

    def _rewrite(self, reports: Sequence[Dict[str, Any]]) -> None:
        try:
            text = "".join(
                json.dumps(report, ensure_ascii=False, allow_nan=False) + "\n"
                for report in reports
            )
            _atomic_write_text(self.path, text)
        except (OSError, ValueError, TypeError, UnicodeError) as exc:
            raise OutboxError("Cannot rewrite report outbox %s: %s" % (self.path, exc)) from exc

    def _drop_head(self) -> None:
        remaining = self._reports[1:]
        self._rewrite(remaining)
        self._reports = remaining

    def flush(
        self,
        sender: Callable[[Dict[str, Any]], None],
        on_dead_letter: Optional[Callable[[Dict[str, Any], BaseException], None]] = None,
        max_reports: int = MAX_OUTBOX_FLUSH_PER_CYCLE,
    ) -> int:
        self._ensure_loaded()
        processed = 0
        limit = max(0, min(max_reports, MAX_OUTBOX_FLUSH_PER_CYCLE))
        while self._reports and processed < limit:
            report = self._reports[0]
            try:
                sender(report)
            except Exception as exc:
                if not (
                    isinstance(exc, SleeckosAPIError)
                    and exc.status_code in DEAD_LETTER_HTTP_STATUSES
                ):
                    raise
                self._append_record(self.dead_path, report)
                self._drop_head()
                processed += 1
                if on_dead_letter is not None:
                    try:
                        on_dead_letter(report, exc)
                    except Exception as alert_exc:
                        logging.getLogger(LOGGER_NAME).warning(
                            "Dead-letter alert failed: %s", alert_exc.__class__.__name__
                        )
                continue
            self._drop_head()
            processed += 1
        return processed

    @property
    def pending_count(self) -> int:
        self._ensure_loaded()
        return len(self._reports)


def _chunks(items: Sequence[Any], size: int) -> Iterator[Sequence[Any]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


class MultiloginClient:
    """Thin, secret-safe wrapper around the Multilogin cloud-phone API."""

    def __init__(self, settings: MultiloginSettings, timeout: int = DEFAULT_TIMEOUT_SECONDS):
        self.settings = settings
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": "Bearer %s" % settings.automation_token,
                "Accept": "application/json",
                "Content-Type": "application/json",
            }
        )

    def close(self) -> None:
        self.session.close()

    def _sanitize(self, value: Any) -> str:
        text = str(value)
        token = self.settings.automation_token
        if token:
            text = text.replace(token, "[redacted]")
        return text

    @staticmethod
    def _authentication_error(path: str) -> MultiloginAPIError:
        return MultiloginAPIError(
            "Multilogin authentication failed (HTTP 401). Check that the automation "
            "token is valid, active, and has cloud-phone API access.",
            status_code=401,
            path=path,
        )

    def _http_error(
        self, method: str, path: str, status_code: int, payload: Any
    ) -> MultiloginAPIError:
        detail = ""
        if isinstance(payload, dict):
            status = payload.get("status")
            if isinstance(status, dict):
                detail = str(status.get("message", ""))
            detail = detail or str(payload.get("message") or payload.get("error") or "")
        suffix = ": %s" % self._sanitize(detail)[:300] if detail else ""
        return MultiloginAPIError(
            "%s %s returned HTTP %d%s" % (method, path, status_code, suffix),
            status_code=status_code,
            path=path,
        )

    def _request(self, method: str, path: str, **kwargs: Any) -> Dict[str, Any]:
        url = "%s%s" % (self.settings.base_url, path)
        try:
            response = self.session.request(method, url, timeout=self.timeout, **kwargs)
        except requests.RequestException as exc:
            raise MultiloginAPIError(
                "%s %s failed: %s" % (method, path, self._sanitize(exc)), path=path
            ) from exc

        if response.status_code == 401:
            raise self._authentication_error(path)

        try:
            payload = response.json()
        except ValueError as exc:
            raise MultiloginAPIError(
                "%s %s returned HTTP %d with a non-JSON response"
                % (method, path, response.status_code),
                status_code=response.status_code,
                path=path,
            ) from exc

        if response.status_code >= 400:
            raise self._http_error(method, path, response.status_code, payload)
        if not isinstance(payload, dict):
            raise MultiloginAPIError(
                "%s %s returned an unexpected JSON response" % (method, path), path=path
            )

        # Multilogin can return HTTP 200 while embedding the real failure in
        # status.http_code. Never mistake that for an empty/successful result.
        embedded_status = payload.get("status")
        if isinstance(embedded_status, dict):
            embedded_code = embedded_status.get("http_code")
            if isinstance(embedded_code, int) and embedded_code >= 400:
                if embedded_code == 401:
                    raise self._authentication_error(path)
                raise self._http_error(method, path, embedded_code, payload)
        return payload

    def list_running_profiles(self) -> List[Dict[str, Any]]:
        profiles: List[Dict[str, Any]] = []
        seen_ids = set()
        page = 1
        while True:
            payload = self._request(
                "GET",
                "/mobile_profiles/phone/list",
                params={"is_running": "true", "page": page, "page_size": DEFAULT_PAGE_SIZE},
            )
            data = payload.get("data") or {}
            items = data.get("items") or []
            if not isinstance(items, list):
                raise MultiloginAPIError(
                    "Phone list response did not contain data.items as a list",
                    path="/mobile_profiles/phone/list",
                )
            for profile in items:
                if not isinstance(profile, dict):
                    continue
                profile_id = str(profile.get("id", ""))
                if profile_id and profile_id in seen_ids:
                    continue
                if profile_id:
                    seen_ids.add(profile_id)
                profiles.append(profile)
            if len(items) < DEFAULT_PAGE_SIZE:
                break
            page += 1
        return profiles

    def get_statuses(self, profile_ids: Sequence[str]) -> Dict[str, Any]:
        self._validate_batch(profile_ids)
        return self._request(
            "POST", "/mobile_profiles/phone/statuses", json={"ids": list(profile_ids)}
        )

    def stop_profiles(self, profile_ids: Sequence[str]) -> Dict[str, Any]:
        self._validate_batch(profile_ids)
        return self._request(
            "POST", "/mobile_profiles/phone/stop", json={"ids": list(profile_ids)}
        )

    def update_profile_tags(self, profile_id: str, tags: Sequence[str]) -> Dict[str, Any]:
        if not profile_id:
            raise ValueError("profile_id is required")
        return self._request(
            "PUT",
            "/mobile_profiles/phone/update",
            json={"id": profile_id, "tags": list(tags)},
        )

    @staticmethod
    def _validate_batch(profile_ids: Sequence[str]) -> None:
        if not profile_ids:
            raise ValueError("At least one profile ID is required")
        if len(profile_ids) > 50:
            raise ValueError("Multilogin batches cannot exceed 50 profile IDs")


def _remote_config_to_payload(config: RemoteConfig) -> Dict[str, Any]:
    return {
        "enforcementEnabled": config.enforcement_enabled,
        "checkIntervalSeconds": config.check_interval_seconds,
        "rules": {
            "by_tag": {
                tag: {
                    "max_runtime_minutes": rule.max_runtime_minutes,
                    "description": rule.description,
                }
                for tag, rule in config.rules.by_tag.items()
            },
            "default": {
                "max_runtime_minutes": config.rules.default.max_runtime_minutes,
                "description": config.rules.default.description,
            },
        },
        "configVersion": config.config_version,
    }


class SleeckosClient:
    """Secret-safe HTTP client for SleeckOS Guardian integration."""

    def __init__(self, settings: SleeckosSettings):
        self.settings = settings
        self.session = requests.Session()
        self.session.headers.update(
            {
                "x-guardian-secret": settings.shared_secret,
                "Accept": "application/json",
                "Content-Type": "application/json",
            }
        )

    def close(self) -> None:
        self.session.close()

    def _sanitize(self, value: Any) -> str:
        text = str(value)
        if self.settings.shared_secret:
            text = text.replace(self.settings.shared_secret, "[redacted]")
        return text

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = "%s%s" % (self.settings.base_url, path)
        try:
            response = self.session.request(
                method, url, timeout=self.settings.timeout_seconds, **kwargs
            )
        except requests.RequestException as exc:
            raise SleeckosAPIError(
                "%s %s failed: %s" % (method, path, exc.__class__.__name__), path=path
            ) from exc
        if not 200 <= response.status_code < 300:
            raise SleeckosAPIError(
                "%s %s returned HTTP %d" % (method, path, response.status_code),
                status_code=response.status_code,
                path=path,
            )
        return response

    def fetch_config(self) -> RemoteConfig:
        response = self._request("GET", SLEECKOS_CONFIG_PATH)
        try:
            payload = response.json()
        except ValueError as exc:
            raise SleeckosAPIError(
                "GET %s returned a non-JSON response" % SLEECKOS_CONFIG_PATH,
                status_code=response.status_code,
                path=SLEECKOS_CONFIG_PATH,
            ) from exc
        try:
            return _remote_config_from_payload(payload)
        except ConfigError as exc:
            raise SleeckosAPIError(
                "GET %s returned invalid config: %s"
                % (SLEECKOS_CONFIG_PATH, self._sanitize(exc)),
                status_code=response.status_code,
                path=SLEECKOS_CONFIG_PATH,
            ) from exc

    def send_report(self, report: Dict[str, Any]) -> None:
        self._request("POST", SLEECKOS_EVENTS_PATH, json=report)


class RuleEngine:
    """Select a runtime rule by the first recognized profile tag."""

    def __init__(self, settings: RuleSettings):
        self.settings = settings

    def match(self, profile: Dict[str, Any]) -> Tuple[RuntimeRule, Optional[str]]:
        tags = profile.get("tags") or []
        if not isinstance(tags, list):
            tags = []
        for raw_tag in tags:
            tag = str(raw_tag).strip().lower()
            if tag in self.settings.by_tag:
                return self.settings.by_tag[tag], tag
        return self.settings.default, None

    def evaluate(
        self, profile: Dict[str, Any], status: Dict[str, Any]
    ) -> Tuple[bool, float, float, str]:
        rule, matched_tag = self.match(profile)
        limit_min = float(rule.max_runtime_minutes)
        raw_seconds = status.get("running_time_secs")
        try:
            running_seconds = max(0.0, float(raw_seconds))
        except (TypeError, ValueError):
            running_seconds = 0.0
        running_min = running_seconds / 60.0
        rule_name = "tag '%s'" % matched_tag if matched_tag else "default rule"

        if status.get("status") != 0:
            return False, limit_min, running_min, "status is not Started (0)"
        if raw_seconds is None:
            return False, limit_min, running_min, "missing running_time_secs"
        should_stop = running_seconds >= limit_min * 60.0
        if should_stop:
            reason = "%s: %.2fmin ran >= %.2fmin limit" % (rule_name, running_min, limit_min)
        else:
            reason = "%s: %.2fmin ran < %.2fmin limit" % (rule_name, running_min, limit_min)
        return should_stop, limit_min, running_min, reason


class Notifier:
    """Optional webhook notifier; failures never interrupt Guardian cycles."""

    def __init__(self, settings: NotificationSettings, timeout: int = 10):
        self.settings = settings
        self.timeout = timeout
        self.session = requests.Session()
        self.logger = logging.getLogger(LOGGER_NAME)

    def close(self) -> None:
        self.session.close()

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    def notify_stop(self, profiles: Sequence[str], succeeded: int, failed: int) -> None:
        if not (self.settings.enabled and self.settings.notify_on_stop):
            return
        message = "Stopped %d profile(s)." % succeeded
        if failed:
            message += " %d stop request(s) failed." % failed
        self._send(
            {
                "title": "Multilogin Guardian: Profiles Stopped",
                "message": message,
                "profiles": list(profiles),
                "timestamp": self._timestamp(),
            }
        )

    def notify_error(self, message: str) -> None:
        if not (self.settings.enabled and self.settings.notify_on_error):
            return
        self._send(
            {
                "title": "Multilogin Guardian: Error",
                "message": message,
                "profiles": [],
                "timestamp": self._timestamp(),
            }
        )

    def _send(self, payload: Dict[str, Any]) -> None:
        try:
            response = self.session.post(
                self.settings.webhook_url, json=payload, timeout=self.timeout
            )
            if response.status_code >= 400:
                self.logger.warning("Notification webhook returned HTTP %d", response.status_code)
        except requests.RequestException as exc:
            # Request exceptions often contain the full webhook URL, including
            # its secret path/query. Log only the transport error category.
            self.logger.warning("Notification webhook failed: %s", exc.__class__.__name__)


def configure_logging(settings: LoggingSettings) -> logging.Logger:
    """Configure Guardian handlers without discarding working ones on failure."""

    logger = logging.getLogger(LOGGER_NAME)
    formatter = logging.Formatter(LOG_FORMAT, datefmt=LOG_DATE_FORMAT)
    new_handlers = []
    try:
        log_path = Path(settings.file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            log_path,
            maxBytes=settings.max_bytes,
            backupCount=settings.backup_count,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        new_handlers.append(file_handler)
        if settings.console:
            console_handler = logging.StreamHandler()
            console_handler.setFormatter(formatter)
            new_handlers.append(console_handler)
    except Exception:
        for handler in new_handlers:
            handler.close()
        raise

    for handler in list(logger.handlers):
        logger.removeHandler(handler)
        handler.close()
    for handler in new_handlers:
        logger.addHandler(handler)
    logger.setLevel(getattr(logging, settings.level))
    logger.propagate = False
    return logger


class GuardianDaemon:
    """Main polling loop and cycle orchestrator."""

    def __init__(
        self,
        config: Config,
        config_path: Optional[os.PathLike] = None,
        client: Optional[MultiloginClient] = None,
        notifier: Optional[Notifier] = None,
        client_factory: Callable[[MultiloginSettings], MultiloginClient] = MultiloginClient,
        notifier_factory: Callable[[NotificationSettings], Notifier] = Notifier,
        sleeckos_client: Optional[SleeckosClient] = None,
        sleeckos_client_factory: Callable[[SleeckosSettings], SleeckosClient] = SleeckosClient,
        outbox: Optional[ReportOutbox] = None,
    ):
        self.config = config
        self.config_path = Path(config_path).resolve() if config_path else None
        self.logger = configure_logging(config.logging)
        self._client_factory = client_factory
        self._notifier_factory = notifier_factory
        self._sleeckos_client_factory = sleeckos_client_factory
        self.client = client or client_factory(config.multilogin)
        self.notifier = notifier or notifier_factory(config.notifications)
        self.sleeckos_client = None
        self.outbox = None
        if config.sleeckos.enabled:
            self.sleeckos_client = sleeckos_client or sleeckos_client_factory(config.sleeckos)
            self.outbox = outbox or ReportOutbox(
                config.sleeckos.report_outbox,
                sensitive_values=(config.multilogin.automation_token, config.sleeckos.shared_secret),
            )
        self.rule_engine = RuleEngine(config.rules)
        self.check_interval_seconds = config.multilogin.check_interval_seconds
        self.enforcement_enabled = not config.sleeckos.enabled
        self.remote_config_version: Optional[str] = None
        self._last_remote_config: Optional[RemoteConfig] = None
        self.last_cycle_report: Optional[Dict[str, Any]] = None
        self.running = True
        self.reload_requested = False
        self._wake = threading.Event()

    def install_signal_handlers(self) -> None:
        signal.signal(signal.SIGTERM, self.handle_stop_signal)
        signal.signal(signal.SIGINT, self.handle_stop_signal)
        if hasattr(signal, "SIGHUP"):
            signal.signal(signal.SIGHUP, self.handle_reload_signal)

    def handle_stop_signal(self, signum: int, _frame: Any = None) -> None:
        self.running = False
        self._wake.set()

    def handle_reload_signal(self, signum: int, _frame: Any = None) -> None:
        self.reload_requested = True
        self._wake.set()

    def _error_message(self, error: BaseException) -> str:
        message = str(error) or error.__class__.__name__
        sensitive_values = [self.config.multilogin.automation_token]
        if self.config.sleeckos.shared_secret:
            sensitive_values.append(self.config.sleeckos.shared_secret)
        for value in sensitive_values:
            if value:
                message = message.replace(value, "[redacted]")
        return message

    def _cycle_error(self, message: str, error: BaseException) -> None:
        detail = self._error_message(error)
        self.logger.error("%s: %s", message, detail)
        self.notifier.notify_error("%s: %s" % (message, detail))

    def _apply_local_behavior(self) -> None:
        self.rule_engine = RuleEngine(self.config.rules)
        self.check_interval_seconds = self.config.multilogin.check_interval_seconds
        self.enforcement_enabled = not self.config.sleeckos.enabled
        self.remote_config_version = None

    def _apply_remote_config(self, remote: RemoteConfig) -> None:
        self.rule_engine = RuleEngine(remote.rules)
        self.check_interval_seconds = remote.check_interval_seconds
        self.enforcement_enabled = remote.enforcement_enabled
        self.remote_config_version = remote.config_version
        self._last_remote_config = remote

    def _cached_remote_config(self) -> RemoteConfig:
        cache_path = Path(self.config.sleeckos.remote_config_cache)
        try:
            with cache_path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except FileNotFoundError as exc:
            raise ConfigError("No SleeckOS remote config cache is available") from exc
        except (OSError, json.JSONDecodeError) as exc:
            raise ConfigError("Cannot read SleeckOS remote config cache: %s" % exc) from exc
        return _remote_config_from_payload(payload)

    def _prepare_cycle(self) -> None:
        if not self.config.sleeckos.enabled:
            return
        if self.sleeckos_client is None:
            raise RuntimeError("SleeckOS integration client is not initialized")
        try:
            remote = self.sleeckos_client.fetch_config()
        except Exception as exc:
            self._cycle_error("SleeckOS config fetch failed", exc)
            remote = self._last_remote_config
            source = "last known good"
            if remote is None:
                try:
                    remote = self._cached_remote_config()
                    source = "disk cache"
                except Exception as cache_exc:
                    self._apply_local_behavior()
                    self._cycle_error(
                        "SleeckOS cached config unavailable; using local rules with enforcement disabled",
                        cache_exc,
                    )
                    return
            self._apply_remote_config(remote)
            self.logger.warning("Using %s SleeckOS config after fetch failure", source)
            return

        self._apply_remote_config(remote)
        try:
            _atomic_write_json(
                Path(self.config.sleeckos.remote_config_cache),
                _remote_config_to_payload(remote),
            )
        except Exception as exc:
            self._cycle_error("Could not persist SleeckOS remote config cache", exc)
        self.logger.info(
            "Applied SleeckOS remote config; enforcement=%s",
            "enabled" if remote.enforcement_enabled else "disabled",
        )

    @staticmethod
    def _utc_timestamp() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @staticmethod
    def _empty_summary() -> Dict[str, int]:
        return {
            "running": 0,
            "stop_requested": 0,
            "stopped": 0,
            "stop_failed": 0,
            "stop_unknown": 0,
        }

    def _apply_reload(self) -> None:
        if not self.reload_requested:
            return
        self.reload_requested = False
        if not self.config_path:
            self.logger.warning("Cannot reload configuration: no config path was provided")
            return
        new_client = None
        new_notifier = None
        new_sleeckos_client = None
        try:
            new_config = Config.load(self.config_path)
            new_client = self._client_factory(new_config.multilogin)
            new_notifier = self._notifier_factory(new_config.notifications)
            if new_config.sleeckos.enabled:
                new_sleeckos_client = self._sleeckos_client_factory(new_config.sleeckos)
            new_logger = configure_logging(new_config.logging)
        except Exception as exc:
            if new_client is not None:
                new_client.close()
            if new_notifier is not None:
                new_notifier.close()
            if new_sleeckos_client is not None:
                new_sleeckos_client.close()
            self._cycle_error("Configuration reload failed; keeping previous configuration", exc)
            return

        old_client = self.client
        old_notifier = self.notifier
        old_sleeckos_client = self.sleeckos_client
        self.config = new_config
        self.client = new_client
        self.notifier = new_notifier
        self.sleeckos_client = new_sleeckos_client
        self.outbox = None
        if new_config.sleeckos.enabled:
            self.outbox = ReportOutbox(
                new_config.sleeckos.report_outbox,
                sensitive_values=(
                    new_config.multilogin.automation_token,
                    new_config.sleeckos.shared_secret,
                ),
            )
        self._last_remote_config = None
        self._apply_local_behavior()
        self.logger = new_logger
        old_client.close()
        old_notifier.close()
        if old_sleeckos_client is not None:
            old_sleeckos_client.close()
        self.logger.info("Configuration reloaded successfully")

    @staticmethod
    def _profile_name(profile: Dict[str, Any]) -> str:
        profile_id = str(profile.get("id", "unknown"))
        return str(profile.get("serial_name") or profile.get("name") or profile_id)

    @staticmethod
    def _failure_details(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        data = payload.get("data") or {}
        details = data.get("fail_details") or []
        return details if isinstance(details, list) else []

    def _tag_breakdown(self, profiles: Sequence[Dict[str, Any]]) -> str:
        counts: Counter = Counter()
        for profile in profiles:
            _rule, tag = self.rule_engine.match(profile)
            counts[tag or "default"] += 1
        if not counts:
            return "none"
        return ", ".join("%s=%d" % (tag, counts[tag]) for tag in sorted(counts))

    @staticmethod
    def _report_profile_id(profile: Dict[str, Any]) -> str:
        raw_id = profile.get("id")
        if raw_id is None or isinstance(raw_id, bool):
            return ""
        profile_id = str(raw_id).strip()
        safe_id = _bounded_report_text(profile_id, MAX_REPORT_ID_LENGTH + 1)
        if not safe_id or safe_id != profile_id or _utf16_length(safe_id) > MAX_REPORT_ID_LENGTH:
            return ""
        return safe_id

    @staticmethod
    def _report_number(value: Any) -> Optional[float]:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        if not math.isfinite(float(value)) or value < 0:
            return None
        return value

    @staticmethod
    def _report_limit(value: Any) -> Optional[float]:
        number = GuardianDaemon._report_number(value)
        return number if number is not None and number > 0 else None

    @staticmethod
    def _profile_tags(profile: Dict[str, Any]) -> List[str]:
        tags = profile.get("tags") or []
        if not isinstance(tags, list):
            return []
        safe_tags = []
        for raw_tag in tags[:MAX_REPORT_TAGS]:
            tag = _bounded_report_text(raw_tag, MAX_REPORT_TAG_LENGTH).strip()
            if tag:
                safe_tags.append(tag)
        return safe_tags

    @staticmethod
    def _detail_ids(details: Sequence[Any], profile_ids: Sequence[str]) -> set:
        requested = set(profile_ids)
        identifiers = set()
        for detail in details:
            if not isinstance(detail, dict):
                continue
            profile_id = detail.get("id") or detail.get("profile_id")
            if profile_id is not None and str(profile_id) in requested:
                identifiers.add(str(profile_id))
        return identifiers

    def _classify_stop_batch(
        self,
        profile_ids: Sequence[str],
        payload: Dict[str, Any],
        succeeded: int,
        failed: int,
        failures: Sequence[Any],
    ) -> Dict[str, str]:
        data = payload.get("data") or {}
        success_details = data.get("success_details") or []
        if not isinstance(success_details, list):
            success_details = []
        success_ids = self._detail_ids(success_details, profile_ids)
        failure_ids = self._detail_ids(failures, profile_ids)
        results: Dict[str, str] = {}
        for profile_id in profile_ids:
            if profile_id in success_ids and profile_id in failure_ids:
                results[profile_id] = "unknown"
            elif profile_id in success_ids:
                results[profile_id] = "stopped"
            elif profile_id in failure_ids:
                results[profile_id] = "failed"

        unresolved = [profile_id for profile_id in profile_ids if profile_id not in results]
        remaining_successes = max(0, succeeded - len(success_ids))
        remaining_failures = max(0, failed - len(failure_ids))
        if unresolved and remaining_successes == len(unresolved) and remaining_failures == 0:
            for profile_id in unresolved:
                results[profile_id] = "stopped"
        else:
            for profile_id in unresolved:
                results[profile_id] = "unknown"
        return results

    def _dead_letter_alert(self, _report: Dict[str, Any], error: BaseException) -> None:
        dead_path = self.outbox.dead_path if self.outbox is not None else "dead-letter sidecar"
        self._cycle_error(
            "SleeckOS permanently rejected a cycle report; quarantined to %s" % dead_path,
            error,
        )

    def _deliver_report(self, report: Dict[str, Any]) -> None:
        if not self.config.sleeckos.enabled:
            return
        if self.outbox is None or self.sleeckos_client is None:
            self._cycle_error(
                "SleeckOS cycle report could not be delivered",
                RuntimeError("Integration reporting is not initialized"),
            )
            return
        try:
            self.outbox.append(report)
        except Exception as exc:
            self._cycle_error("Could not persist SleeckOS cycle report; send skipped", exc)
            return
        try:
            self.outbox.flush(
                self.sleeckos_client.send_report,
                on_dead_letter=self._dead_letter_alert,
                max_reports=MAX_OUTBOX_FLUSH_PER_CYCLE,
            )
        except Exception as exc:
            self._cycle_error("SleeckOS report delivery failed; retrying from outbox", exc)

    def _finish_cycle(
        self,
        report: Dict[str, Any],
        summary: Dict[str, int],
        issues: Sequence[str],
    ) -> None:
        finish_issues = list(issues)
        stop_results = Counter(stop["result"] for stop in report["stops"])
        stop_requested = len(report["stops"])
        if len(report["profiles"]) > MAX_REPORT_PROFILES:
            omitted = len(report["profiles"]) - MAX_REPORT_PROFILES
            report["profiles"] = report["profiles"][:MAX_REPORT_PROFILES]
            report["inventoryComplete"] = False
            finish_issues.append("Profile report row cap omitted %d profile(s)" % omitted)
        if len(report["stops"]) > MAX_REPORT_STOPS:
            omitted = len(report["stops"]) - MAX_REPORT_STOPS
            report["stops"] = report["stops"][:MAX_REPORT_STOPS]
            finish_issues.append("Stop report row cap omitted %d stop(s)" % omitted)
        if report["status"] != "error":
            report["status"] = "partial" if finish_issues else "success"
        if finish_issues and "error" not in report:
            report["error"] = "; ".join(dict.fromkeys(finish_issues))
        if "error" in report:
            report["error"] = _bounded_report_text(report["error"], MAX_REPORT_ERROR_LENGTH)
        report["stopRequested"] = stop_requested
        summary["stop_requested"] = stop_requested
        report["stopSucceeded"] = stop_results["stopped"]
        report["stopFailed"] = stop_results["failed"]
        report["stopUnknown"] = stop_results["unknown"]
        summary["stop_unknown"] = stop_results["unknown"]
        report["finishedAt"] = self._utc_timestamp()
        for stop in report["stops"]:
            if "occurredAt" not in stop:
                stop["occurredAt"] = report["finishedAt"]
        self.last_cycle_report = report
        self._deliver_report(report)

    def _execute_cycle(
        self,
        report: Dict[str, Any],
        summary: Dict[str, int],
        issues: List[str],
    ) -> None:
        profiles = self.client.list_running_profiles()
        report["runningCount"] = len(profiles)
        summary["running"] = len(profiles)
        self.logger.info("Running profiles: %d", len(profiles))
        self.logger.info("Tag breakdown: %s", self._tag_breakdown(profiles))
        if not profiles:
            report["inventoryComplete"] = True
            self.logger.info("Cycle complete: no running profiles")
            return

        status_by_id: Dict[str, Dict[str, Any]] = {}
        profile_ids = [self._report_profile_id(profile) for profile in profiles]
        valid_ids = [profile_id for profile_id in profile_ids if profile_id]
        invalid_profile_rows = len(valid_ids) != len(profile_ids)
        if invalid_profile_rows:
            invalid_ids = len(profile_ids) - len(valid_ids)
            self.logger.warning("Skipping %d profile(s) with invalid or empty IDs", invalid_ids)
            issues.append("%d profile(s) had invalid or empty IDs and were omitted" % invalid_ids)

        for batch in _chunks(valid_ids, self.config.multilogin.batch_size):
            try:
                payload = self.client.get_statuses(batch)
            except Exception as exc:
                detail = self._error_message(exc)
                issues.append("Status request failed for %d profile(s): %s" % (len(batch), detail))
                self._cycle_error("Status request failed for %d profile(s)" % len(batch), exc)
                continue
            data = payload.get("data") or {}
            details = data.get("success_details") or []
            for status in details:
                if isinstance(status, dict) and status.get("id") is not None:
                    status_by_id[str(status["id"])] = status
            failures = self._failure_details(payload)
            if failures:
                issues.append("Status lookup failed for %d profile(s)" % len(failures))
            for failure in failures:
                self.logger.warning("Status lookup failed: %s", self._sanitize_failure(failure))

        stop_queue: List[Tuple[str, str]] = []
        stop_report_by_id: Dict[str, Dict[str, Any]] = {}
        missing_statuses = 0
        sanitized_profiles = 0
        for profile in profiles:
            profile_id = self._report_profile_id(profile)
            if not profile_id:
                continue
            status = status_by_id.get(profile_id)
            rule, matched_tag = self.rule_engine.match(profile)
            raw_name = self._profile_name(profile)
            name = _bounded_report_text(raw_name, MAX_REPORT_NAME_LENGTH)
            if not name.strip():
                name = profile_id
            raw_tags = profile.get("tags") or []
            raw_tag_values = [str(tag) for tag in raw_tags] if isinstance(raw_tags, list) else []
            tags = self._profile_tags(profile)
            report_matched_tag = (
                _bounded_report_text(matched_tag, MAX_REPORT_TAG_LENGTH)
                if matched_tag is not None
                else None
            )
            raw_status = status.get("status") if status else None
            raw_runtime = status.get("running_time_secs") if status else None
            status_number = self._report_number(raw_status)
            runtime_number = self._report_number(raw_runtime)
            limit_minutes = self._report_limit(rule.max_runtime_minutes)
            adjusted = (
                name != raw_name
                or tags != raw_tag_values
                or report_matched_tag != matched_tag
                or (raw_status is not None and status_number is None)
                or (raw_runtime is not None and runtime_number is None)
                or limit_minutes is None
            )
            if adjusted:
                sanitized_profiles += 1
            profile_report = {
                "profileId": profile_id,
                "name": name,
                "tags": tags,
                "status": status_number,
                "runningTimeSecs": runtime_number,
                "matchedTag": report_matched_tag,
                "limitMinutes": limit_minutes,
                "decision": "disabled" if not self.enforcement_enabled else "skip",
            }
            report["profiles"].append(profile_report)
            if status is None:
                missing_statuses += 1
                self.logger.warning("SKIP '%s' — no status returned", name)
                continue

            should_stop, limit_min, running_min, reason = self.rule_engine.evaluate(profile, status)
            self.logger.info(
                "PROFILE '%s' — runtime %.2fmin, status=%s, limit %.2fmin",
                name,
                running_min,
                status.get("status", "unknown"),
                limit_min,
            )
            if not self.enforcement_enabled:
                self.logger.debug("DISABLED '%s' — enforcement is disabled", name)
                continue
            if should_stop:
                profile_report["decision"] = "stop"
                self.logger.warning(
                    "WILL STOP '%s' — exceeded %.2fmin (%.2fmin); %s",
                    name,
                    limit_min,
                    running_min,
                    reason,
                )
                stop_queue.append((profile_id, name))
                stop_report = {
                    "profileId": profile_id,
                    "name": name,
                    "tags": list(tags),
                    "matchedTag": report_matched_tag,
                    "runtimeSecs": runtime_number,
                    "limitMinutes": limit_minutes,
                    "result": "unknown",
                }
                report["stops"].append(stop_report)
                stop_report_by_id[profile_id] = stop_report
            else:
                profile_report["decision"] = "keep"
                self.logger.debug("KEEP '%s' — %s", name, reason)

        report["inventoryComplete"] = not invalid_profile_rows
        if sanitized_profiles:
            issues.append(
                "Sanitized invalid or oversized values for %d profile report(s)"
                % sanitized_profiles
            )
        if missing_statuses:
            issues.append("No status returned for %d profile(s)" % missing_statuses)
        report["stopRequested"] = len(stop_queue)
        summary["stop_requested"] = len(stop_queue)
        if not stop_queue:
            self.logger.info("Cycle complete: no profiles exceeded their runtime limits")
            return

        succeeded = 0
        failed = 0
        for batch in _chunks(stop_queue, self.config.multilogin.batch_size):
            batch_ids = [item[0] for item in batch]
            occurred_at = self._utc_timestamp()
            for profile_id in batch_ids:
                stop_report_by_id[profile_id]["occurredAt"] = occurred_at
            try:
                payload = self.client.stop_profiles(batch_ids)
            except Exception as exc:
                status_code = None
                if isinstance(exc, MultiloginAPIError):
                    status_code = exc.status_code
                elif isinstance(exc, requests.HTTPError) and exc.response is not None:
                    status_code = exc.response.status_code
                definitive_rejection = (
                    status_code is not None
                    and 400 <= status_code < 500
                    and status_code not in {408, 429}
                )
                result = "failed" if definitive_rejection else "unknown"
                if result == "failed":
                    failed += len(batch)
                detail = _bounded_report_text(
                    self._error_message(exc), MAX_REPORT_ERROR_LENGTH
                )
                issue = "Stop request rejected" if result == "failed" else "Stop outcome unknown"
                issues.append("%s for %d profile(s): %s" % (issue, len(batch), detail))
                for profile_id in batch_ids:
                    stop_report_by_id[profile_id]["result"] = result
                    stop_report_by_id[profile_id]["error"] = detail
                self._cycle_error("Stop request failed for %d profile(s)" % len(batch), exc)
                continue
            data = payload.get("data") or {}
            batch_succeeded = int(data.get("success_amount") or 0)
            failures = self._failure_details(payload)
            batch_failed = int(data.get("fail_amount") or len(failures) or 0)
            succeeded += batch_succeeded
            failed += batch_failed
            results = self._classify_stop_batch(
                batch_ids, payload, batch_succeeded, batch_failed, failures
            )
            for profile_id, result in results.items():
                stop_report_by_id[profile_id]["result"] = result
            for failure in failures:
                safe_failure = _bounded_report_text(
                    self._sanitize_failure(failure), MAX_REPORT_ERROR_LENGTH
                )
                if isinstance(failure, dict):
                    failure_id = failure.get("id") or failure.get("profile_id")
                    if (
                        failure_id is not None
                        and str(failure_id) in batch_ids
                        and str(failure_id) in stop_report_by_id
                    ):
                        stop_report_by_id[str(failure_id)]["error"] = safe_failure
                self.logger.warning("Stop failed: %s", safe_failure)

        summary["stopped"] = succeeded
        summary["stop_failed"] = failed
        unknown = sum(1 for stop in report["stops"] if stop["result"] == "unknown")
        if failed:
            issues.append("%d stop request(s) failed" % failed)
        if unknown:
            issues.append("%d stop result(s) were ambiguous" % unknown)
        stopped_names = [
            stop["name"] for stop in report["stops"] if stop["result"] == "stopped"
        ]
        if succeeded:
            self.notifier.notify_stop(stopped_names, succeeded, failed)
        self.logger.info(
            "Stop complete: requested=%d succeeded=%d failed=%d unknown=%d",
            len(stop_queue),
            succeeded,
            failed,
            unknown,
        )

    def run_cycle(self) -> Dict[str, int]:
        summary = self._empty_summary()
        issues: List[str] = []
        report: Dict[str, Any] = {
            "cycleId": str(uuid.uuid4()),
            "startedAt": self._utc_timestamp(),
            "finishedAt": self._utc_timestamp(),
            "status": "success",
            "inventoryComplete": False,
            "runningCount": 0,
            "stopRequested": 0,
            "stopSucceeded": 0,
            "stopFailed": 0,
            "stopUnknown": 0,
            "profiles": [],
            "stops": [],
        }
        try:
            self._prepare_cycle()
            self._execute_cycle(report, summary, issues)
        except Exception as exc:
            detail = self._error_message(exc)
            report["status"] = "error"
            report["error"] = detail
            self._cycle_error("Guardian cycle failed", exc)
        finally:
            self._finish_cycle(report, summary, issues)
        return summary

    def _sanitize_failure(self, failure: Any) -> str:
        if not isinstance(failure, dict):
            return self._error_message(MultiloginAPIError(str(failure)))
        safe = {
            key: value
            for key, value in failure.items()
            if not any(word in str(key).lower() for word in ("token", "secret"))
        }
        return self._error_message(MultiloginAPIError(str(safe)))

    def _run_protected_cycle(self) -> None:
        """Start at most one cycle, with shutdown signals atomic around entry.

        On systemd platforms, SIGTERM/SIGINT stay blocked until the active cycle
        finishes. A pending signal is then handled before another cycle can start.
        """

        stop_signals = {signal.SIGTERM, signal.SIGINT}
        can_block = hasattr(signal, "pthread_sigmask") and hasattr(signal, "SIG_BLOCK")
        if can_block:
            signal.pthread_sigmask(signal.SIG_BLOCK, stop_signals)
        try:
            if not self.running:
                return
            try:
                self.run_cycle()
            except Exception as exc:
                self._cycle_error("Guardian cycle failed", exc)
        finally:
            if can_block:
                signal.pthread_sigmask(signal.SIG_UNBLOCK, stop_signals)

    def run(self) -> None:
        self.install_signal_handlers()
        self.logger.info(
            "Guardian started; check interval %.2fs, batch size %d",
            self.config.multilogin.check_interval_seconds,
            self.config.multilogin.batch_size,
        )
        try:
            while self.running:
                self._apply_reload()
                if not self.running:
                    break
                self._run_protected_cycle()
                self._apply_reload()
                if not self.running:
                    break
                self._wake.wait(self.check_interval_seconds)
                self._wake.clear()
        finally:
            self.client.close()
            self.notifier.close()
            if self.sleeckos_client is not None:
                self.sleeckos_client.close()
            self.logger.info("Guardian stopped.")


def _warn_on_insecure_config(path: Path, logger: logging.Logger) -> None:
    try:
        mode = stat.S_IMODE(path.stat().st_mode)
    except OSError:
        return
    if mode & 0o077:
        logger.warning("Config %s is not private; run chmod 600 on it", path)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Multilogin cloud-phone runtime guardian")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).resolve().with_name("config.json")),
        help="Path to config.json (default: beside agent.py)",
    )
    args = parser.parse_args(argv)

    if hasattr(os, "geteuid") and os.geteuid() == 0:
        parser.error("The Guardian daemon must not run as root; use the guardian system user")

    config_path = Path(args.config).expanduser().resolve()
    try:
        config = Config.load(config_path)
        daemon = GuardianDaemon(config, config_path=config_path)
    except (ConfigError, OSError) as exc:
        print("Configuration error: %s" % exc, file=sys.stderr)
        return 2

    _warn_on_insecure_config(config_path, daemon.logger)
    daemon.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
