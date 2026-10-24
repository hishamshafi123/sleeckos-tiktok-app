#!/usr/bin/env python3
"""Bulk-replace Multilogin cloud-phone tags from a CSV or JSON mapping.

Warning: each update sends a complete replacement tags list containing only the
account type from the input file. Existing tags on that profile are replaced.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from agent import Config, ConfigError, MultiloginAPIError, MultiloginClient


@dataclass(frozen=True)
class TagAssignment:
    profile_id: str
    account_type: str


class BulkTagInputError(ValueError):
    """Raised when the bulk-tag input file is invalid."""


def _validated_assignment(profile_id: Any, account_type: Any, source: str) -> TagAssignment:
    if not isinstance(profile_id, (str, int)) or isinstance(profile_id, bool):
        raise BulkTagInputError("%s: profile_id must be a string or integer" % source)
    if not isinstance(account_type, str) or not account_type.strip():
        raise BulkTagInputError("%s: account_type must be a non-empty string" % source)
    clean_id = str(profile_id).strip()
    clean_type = account_type.strip().lower()
    if not clean_id:
        raise BulkTagInputError("%s: profile_id cannot be empty" % source)
    if any(character.isspace() for character in clean_id):
        raise BulkTagInputError("%s: profile_id cannot contain whitespace" % source)
    return TagAssignment(profile_id=clean_id, account_type=clean_type)


def _check_duplicates(assignments: Sequence[TagAssignment]) -> None:
    seen = set()
    for assignment in assignments:
        if assignment.profile_id in seen:
            raise BulkTagInputError("Duplicate profile_id: %s" % assignment.profile_id)
        seen.add(assignment.profile_id)


def load_csv_assignments(path: Path) -> List[TagAssignment]:
    assignments: List[TagAssignment] = []
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            fields = {field.strip() for field in (reader.fieldnames or []) if field}
            required = {"profile_id", "account_type"}
            if not required.issubset(fields):
                raise BulkTagInputError(
                    "%s: CSV header must contain profile_id,account_type" % path
                )
            for line_number, row in enumerate(reader, start=2):
                assignments.append(
                    _validated_assignment(
                        row.get("profile_id"),
                        row.get("account_type"),
                        "%s line %d" % (path, line_number),
                    )
                )
    except csv.Error as exc:
        raise BulkTagInputError("%s: invalid CSV: %s" % (path, exc)) from exc
    _check_duplicates(assignments)
    return assignments


def _json_object_without_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BulkTagInputError("Duplicate JSON object key: %s" % key)
        result[key] = value
    return result


def load_json_assignments(path: Path) -> List[TagAssignment]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            raw = json.load(handle, object_pairs_hook=_json_object_without_duplicates)
    except json.JSONDecodeError as exc:
        raise BulkTagInputError(
            "%s: invalid JSON at line %d, column %d: %s"
            % (path, exc.lineno, exc.colno, exc.msg)
        ) from exc
    except BulkTagInputError as exc:
        raise BulkTagInputError("%s: %s" % (path, exc)) from exc

    assignments: List[TagAssignment] = []
    if isinstance(raw, dict):
        for profile_id, account_type in raw.items():
            assignments.append(
                _validated_assignment(profile_id, account_type, "%s[%s]" % (path, profile_id))
            )
    elif isinstance(raw, list):
        for index, item in enumerate(raw):
            source = "%s[%d]" % (path, index)
            if not isinstance(item, dict):
                raise BulkTagInputError("%s: each entry must be a JSON object" % source)
            assignments.append(
                _validated_assignment(
                    item.get("profile_id"), item.get("account_type"), source
                )
            )
    else:
        raise BulkTagInputError(
            "%s: JSON must be an object mapping profile_id to account_type, or a list of objects"
            % path
        )
    _check_duplicates(assignments)
    return assignments


def load_assignments(path: Path) -> List[TagAssignment]:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return load_csv_assignments(path)
    if suffix == ".json":
        return load_json_assignments(path)
    raise BulkTagInputError("Input file must end in .csv or .json: %s" % path)


def _check_api_result(payload: Dict[str, Any], profile_id: str) -> None:
    status = payload.get("status")
    if isinstance(status, dict):
        http_code = status.get("http_code")
        if isinstance(http_code, int) and http_code >= 400:
            message = status.get("message") or "update rejected"
            raise MultiloginAPIError(
                "Profile %s update failed: %s" % (profile_id, message),
                status_code=http_code,
                path="/mobile_profiles/phone/update",
            )
    data = payload.get("data")
    if isinstance(data, dict) and (data.get("fail_details") or data.get("fail_amount")):
        raise MultiloginAPIError(
            "Profile %s update returned a failure result" % profile_id,
            path="/mobile_profiles/phone/update",
        )


def run_bulk_tag(
    assignments: Sequence[TagAssignment], client: MultiloginClient
) -> int:
    failures = 0
    total = len(assignments)
    for index, assignment in enumerate(assignments, start=1):
        prefix = "[%d/%d] %s" % (index, total, assignment.profile_id)
        try:
            payload = client.update_profile_tags(
                assignment.profile_id, [assignment.account_type]
            )
            _check_api_result(payload, assignment.profile_id)
        except Exception as exc:
            failures += 1
            message = str(exc).replace(
                client.settings.automation_token, "[redacted]"
            )
            print("%s FAILED: %s" % (prefix, message), file=sys.stderr)
        else:
            print("%s OK tags=[%s]" % (prefix, assignment.account_type))
    return failures


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Replace Multilogin phone tags from a CSV or JSON file"
    )
    parser.add_argument("input", help="CSV or JSON mapping of profile_id to account_type")
    parser.add_argument(
        "--config",
        default=str(Path(__file__).resolve().with_name("config.json")),
        help="Path to config.json (default: beside bulk_tag.py)",
    )
    args = parser.parse_args(argv)

    try:
        assignments = load_assignments(Path(args.input).expanduser().resolve())
        if not assignments:
            raise BulkTagInputError("Input contains no profile assignments")
        config = Config.load(Path(args.config).expanduser().resolve())
    except (BulkTagInputError, ConfigError, OSError) as exc:
        print("Input/configuration error: %s" % exc, file=sys.stderr)
        return 2

    print(
        "Loaded %d profile(s). Each update replaces all existing tags with its account_type."
        % len(assignments)
    )
    client = MultiloginClient(config.multilogin)
    try:
        failures = run_bulk_tag(assignments, client)
    except KeyboardInterrupt:
        print("Interrupted; remaining profiles were not updated.", file=sys.stderr)
        return 130
    finally:
        client.close()

    if failures:
        print("Completed with %d failure(s)." % failures, file=sys.stderr)
        return 1
    print("Completed successfully: %d profile(s) updated." % len(assignments))
    return 0


if __name__ == "__main__":
    sys.exit(main())
