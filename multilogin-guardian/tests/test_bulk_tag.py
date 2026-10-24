import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from agent import MultiloginAPIError, MultiloginSettings
from bulk_tag import (
    BulkTagInputError,
    TagAssignment,
    load_assignments,
    load_json_assignments,
    run_bulk_tag,
)


class BulkTagParsingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_reads_csv(self):
        path = self.root / "profiles.csv"
        path.write_text(
            "profile_id,account_type\n619005104636297579,political\n618154668161237077,state\n",
            encoding="utf-8",
        )
        assignments = load_assignments(path)
        self.assertEqual(
            assignments,
            [
                TagAssignment("619005104636297579", "political"),
                TagAssignment("618154668161237077", "state"),
            ],
        )

    def test_reads_json_mapping_and_list(self):
        mapping = self.root / "mapping.json"
        mapping.write_text(json.dumps({"phone-1": "POLITICAL"}), encoding="utf-8")
        self.assertEqual(
            load_json_assignments(mapping), [TagAssignment("phone-1", "political")]
        )

        listing = self.root / "list.json"
        listing.write_text(
            json.dumps([{"profile_id": "phone-2", "account_type": "state"}]),
            encoding="utf-8",
        )
        self.assertEqual(load_json_assignments(listing), [TagAssignment("phone-2", "state")])

    def test_rejects_bad_row_before_api_work(self):
        path = self.root / "bad.csv"
        path.write_text("profile_id,account_type\nphone-1,\n", encoding="utf-8")
        with self.assertRaisesRegex(BulkTagInputError, "line 2"):
            load_assignments(path)

    def test_rejects_duplicate_profile_ids(self):
        path = self.root / "duplicates.json"
        path.write_text(
            json.dumps(
                [
                    {"profile_id": "phone-1", "account_type": "state"},
                    {"profile_id": "phone-1", "account_type": "general"},
                ]
            ),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(BulkTagInputError, "Duplicate"):
            load_assignments(path)

    def test_rejects_duplicate_keys_in_json_object_mapping(self):
        path = self.root / "duplicate-keys.json"
        path.write_text('{"phone-1":"state","phone-1":"general"}', encoding="utf-8")
        with self.assertRaisesRegex(BulkTagInputError, "Duplicate JSON object key"):
            load_assignments(path)

    def test_rejects_unknown_extension(self):
        with self.assertRaisesRegex(BulkTagInputError, ".csv or .json"):
            load_assignments(self.root / "profiles.txt")


class FakeBulkClient:
    def __init__(self, fail_ids=None):
        self.settings = MultiloginSettings(
            base_url="https://api.multilogin.com",
            automation_token="bulk-secret",
            check_interval_seconds=60,
            batch_size=50,
        )
        self.fail_ids = set(fail_ids or [])
        self.calls = []

    def update_profile_tags(self, profile_id, tags):
        self.calls.append((profile_id, list(tags)))
        if profile_id in self.fail_ids:
            raise MultiloginAPIError("temporary failure containing bulk-secret")
        return {"status": {"http_code": 200}, "data": {}}


class BulkTagExecutionTests(unittest.TestCase):
    def test_updates_all_profiles_with_single_replacement_tag(self):
        client = FakeBulkClient()
        assignments = [TagAssignment("phone-1", "political"), TagAssignment("phone-2", "state")]
        with contextlib.redirect_stdout(io.StringIO()):
            failures = run_bulk_tag(assignments, client)
        self.assertEqual(failures, 0)
        self.assertEqual(client.calls, [("phone-1", ["political"]), ("phone-2", ["state"])])

    def test_continues_after_failure_and_redacts_token(self):
        client = FakeBulkClient(fail_ids={"phone-1"})
        assignments = [TagAssignment("phone-1", "political"), TagAssignment("phone-2", "state")]
        stderr = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(stderr):
            failures = run_bulk_tag(assignments, client)
        self.assertEqual(failures, 1)
        self.assertEqual(len(client.calls), 2)
        self.assertIn("[redacted]", stderr.getvalue())
        self.assertNotIn("bulk-secret", stderr.getvalue())

    def test_embedded_api_failure_is_not_treated_as_success(self):
        client = FakeBulkClient()
        client.update_profile_tags = lambda profile_id, tags: {
            "status": {"http_code": 400, "message": "bad update"}
        }
        stderr = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(stderr):
            failures = run_bulk_tag([TagAssignment("phone-1", "state")], client)
        self.assertEqual(failures, 1)
        self.assertIn("bad update", stderr.getvalue())

    def test_fail_amount_without_details_is_not_treated_as_success(self):
        client = FakeBulkClient()
        client.update_profile_tags = lambda profile_id, tags: {
            "status": {"http_code": 200},
            "data": {"success_amount": 0, "fail_amount": 1},
        }
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            failures = run_bulk_tag([TagAssignment("phone-1", "state")], client)
        self.assertEqual(failures, 1)


if __name__ == "__main__":
    unittest.main()
