#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for the automation-run failure classifier.

`classify_automation_run.py` is a standalone script (not a `test_*.py`), so it is
loaded here by path. The fixtures are real run objects captured from
`GET /api/automation/v1/{id}/runs` (one is explicitly synthetic and says so).

The point these tests defend (ISSUE-009): the `environment_unavailable` /
"Timed out: Sandbox not available" string appears on runs that actually ran out of
clock, so it must NOT by itself trigger a retry. Elapsed time decides.

Run:  python3 -m unittest discover -s growth-engine/tests -v
"""
import importlib.util
import json
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SCRIPT = os.path.join(ROOT, "growth-engine", "tests", "classify_automation_run.py")
FIXTURES = os.path.join(ROOT, "growth-engine", "tests", "fixtures")


def _load():
    spec = importlib.util.spec_from_file_location("classify_automation_run", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ClassifyAutomationRunTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def _fixture(self, name):
        with open(os.path.join(FIXTURES, name), encoding="utf-8") as fh:
            return json.load(fh)

    def test_real_sandbox_marker_ceiling_run_is_budget_overrun(self):
        # The headline correction: the real 2026-10-15 failure carried the sandbox
        # string but ran 1954 s, so it is a budget overrun, NOT a sandbox failure.
        run = self._fixture("run-budget-overrun.json")
        cls, action = self.mod.classify(run)
        self.assertEqual(cls, "budget_overrun")
        self.assertIn("do NOT retry", action)

    def test_real_nosandbox_ceiling_run_is_budget_overrun_not_sandbox(self):
        # No sandbox_id, no conversation, sandbox string present — the naive rule
        # would retry. It hit the ceiling (1926 s), so it must be a budget overrun.
        run = self._fixture("run-budget-overrun-nosandbox.json")
        cls, action = self.mod.classify(run)
        self.assertEqual(cls, "budget_overrun")
        self.assertNotIn("re-dispatch", action)

    def test_synthetic_fast_fail_is_sandbox(self):
        run = self._fixture("run-sandbox-unavailable.json")
        cls, action = self.mod.classify(run)
        self.assertEqual(cls, "sandbox")
        self.assertIn("re-dispatch", action)

    def test_config_error_is_classified_config_error(self):
        run = self._fixture("run-config-error.json")
        cls, action = self.mod.classify(run)
        self.assertEqual(cls, "config_error")
        self.assertIn("configuration", action)

    def test_completed_run_is_ok(self):
        cls, _ = self.mod.classify({"status": "COMPLETED", "conversation_id": "x"})
        self.assertEqual(cls, "ok")

    def test_running_run_is_ok(self):
        cls, _ = self.mod.classify({"status": "RUNNING"})
        self.assertEqual(cls, "ok")

    def test_timeout_kind_is_budget_overrun(self):
        run = {
            "status": "FAILED",
            "status_detail": {"kind": "timeout"},
            "error_detail": "Timed out: command timed out or was killed",
            "conversation_id": "abc123",
        }
        cls, action = self.mod.classify(run)
        self.assertEqual(cls, "budget_overrun")
        self.assertIn("prompt", action)

    def test_elapsed_seconds_uses_timeout_at_when_unfinished(self):
        run = {"started_at": "2026-10-15T13:00:00Z", "timeout_at": "2026-10-15T13:32:00Z"}
        self.assertEqual(self.mod.elapsed_seconds(run), 1920)

    def test_coerce_runs_list_picks_newest(self):
        payload = {
            "runs": [
                {"id": "old", "status": "COMPLETED", "started_at": "2026-10-12T00:00:00Z"},
                {
                    "id": "new",
                    "status": "FAILED",
                    "status_detail": {"kind": "environment_unavailable"},
                    "error_detail": "Timed out: Sandbox not available",
                    "conversation_id": None,
                    "started_at": "2026-10-13T00:00:00Z",
                },
            ]
        }
        run = self.mod._coerce_run(payload)
        self.assertEqual(run["id"], "new")


if __name__ == "__main__":
    unittest.main()

