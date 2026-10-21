#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for scripts/system_supervisor.py.

Only the pure, deterministic helpers are tested — the HTTP checks are exercised
by running the script. No network, no API keys.

Run:  python3 -m unittest discover -s growth-engine/tests -v
"""
import importlib.util
import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SS_PATH = os.path.join(ROOT, "scripts", "system_supervisor.py")

spec = importlib.util.spec_from_file_location("system_supervisor", SS_PATH)
SS = importlib.util.module_from_spec(spec)
sys.modules["system_supervisor"] = SS
spec.loader.exec_module(SS)


class TestParseNumstat(unittest.TestCase):
    def test_counts_files_and_html_additions(self):
        text = "\n".join([
            "abcdef0123456789abcdef0123456789abcdef01",
            "10\t2\tindex.html",
            "5\t0\tgrowth-engine/KNOWN_ISSUES.md",
            "0\t0\treports/daily/2026-10-16.md",
        ])
        files, pages = SS._parse_numstat(text)
        self.assertEqual(files, 3)
        self.assertEqual(pages, 1)  # only index.html is HTML with additions

    def test_binary_files_are_counted_but_not_additions(self):
        text = "hash\n-\t-\tassets/img/photo.jpg\n3\t0\tservices/leak-detection.html"
        files, pages = SS._parse_numstat(text)
        self.assertEqual(files, 2)
        self.assertEqual(pages, 1)

    def test_empty_input(self):
        self.assertEqual(SS._parse_numstat(""), (0, 0))

    def test_html_with_zero_added_lines_is_not_a_new_page(self):
        text = "hash\n0\t0\tindex.html"
        _, pages = SS._parse_numstat(text)
        self.assertEqual(pages, 0)

    def test_repeated_paths_count_once(self):
        # A merge commit repeats the same path; counting rows doubled the figure
        # (292 rows vs 148 unique paths) and produced a false FAIL.
        text = "\n".join([
            "hash1", "1\t0\tindex.html",
            "hash2", "1\t0\tindex.html",
            "hash3", "2\t1\tindex.html",
        ])
        files, pages = SS._parse_numstat(text)
        self.assertEqual(files, 1)


class TestAiVisibilityBlind(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
        self.tmp.close()
        self._orig = SS.VISIBILITY_PATH
        SS.VISIBILITY_PATH = self.tmp.name

    def tearDown(self):
        SS.VISIBILITY_PATH = self._orig
        os.unlink(self.tmp.name)

    def _write(self, rows):
        with open(self.tmp.name, "w", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")

    def test_no_rows_fails(self):
        self._write([])
        rec = SS.check_ai_visibility_blind()
        self.assertFalse(rec["ok"])
        self.assertEqual(rec["count"], 0)

    def test_only_proxy_rows_still_fail(self):
        # conventional_proxy says nothing about AI recommendation.
        self._write([{"test_type": "conventional_proxy", "ts": "2026-10-16T00:00:00Z"}])
        rec = SS.check_ai_visibility_blind()
        self.assertFalse(rec["ok"])
        self.assertEqual(rec["count"], 0)

    def test_fresh_ai_platform_row_passes(self):
        now = SS.dt.datetime(2026, 10, 19, tzinfo=SS.dt.timezone.utc)
        self._write([{"test_type": "ai_platform", "ts": "2026-10-18T00:00:00Z"}])
        rec = SS.check_ai_visibility_blind(now=now)
        self.assertTrue(rec["ok"])
        self.assertEqual(rec["count"], 1)

    def test_stale_ai_platform_row_fails(self):
        now = SS.dt.datetime(2026, 10, 19, tzinfo=SS.dt.timezone.utc)
        self._write([{"test_type": "ai_platform", "ts": "2026-09-01T00:00:00Z"}])
        rec = SS.check_ai_visibility_blind(now=now)
        self.assertFalse(rec["ok"])

    def test_newest_ai_platform_row_is_picked(self):
        self._write([
            {"test_type": "ai_platform", "ts": "2026-10-01T00:00:00Z"},
            {"test_type": "conventional_proxy", "ts": "2026-10-30T00:00:00Z"},
            {"test_type": "ai_platform", "ts": "2026-10-10T00:00:00Z"},
        ])
        count, newest = SS._newest_ai_platform_row(self.tmp.name)
        self.assertEqual(count, 2)
        self.assertEqual(newest, "2026-10-10T00:00:00Z")


class TestMergedByFallback(unittest.TestCase):
    def test_uses_list_field_when_present(self):
        pr = {"number": 1, "merged_by": {"login": "alice"}}
        self.assertEqual(SS._merged_by_login(pr, "tok"), "alice")

    def test_falls_back_to_single_pr_endpoint(self):
        calls = []

        def fake_http(url, token=None, accept="application/vnd.github+json"):
            calls.append(url)
            return {"merged_by": {"login": "bob"}}

        orig = SS._http_json
        SS._http_json = fake_http
        try:
            pr = {"number": 42}  # list endpoint omits merged_by
            self.assertEqual(SS._merged_by_login(pr, "tok"), "bob")
        finally:
            SS._http_json = orig
        self.assertTrue(any("/pulls/42" in u for u in calls))

    def test_returns_none_when_unreadable(self):
        def boom(url, token=None, accept="application/vnd.github+json"):
            raise RuntimeError("nope")

        orig = SS._http_json
        SS._http_json = boom
        try:
            self.assertIsNone(SS._merged_by_login({"number": 7}, "tok"))
        finally:
            SS._http_json = orig


class TestUnexpectedBranches(unittest.TestCase):
    def test_known_prefixes_are_allowed(self):
        branches = ["main", "intelligence-hq/daily-2026-10-16",
                    "technical-seo/2026-10-15-audit-fixes", "tests/seo-audit-parser-coverage",
                    "fix/automation-deploy-contract"]
        self.assertEqual(SS._unexpected_from(branches), [])

    def test_unknown_branch_is_flagged(self):
        branches = ["main", "some-random-agent-branch"]
        self.assertEqual(SS._unexpected_from(branches), ["some-random-agent-branch"])

    def test_main_is_never_unexpected(self):
        self.assertEqual(SS._unexpected_from(["main"]), [])


class TestBudgetConstants(unittest.TestCase):
    def test_thresholds_are_positive(self):
        self.assertGreater(SS.MAX_OPEN_PRS, 0)
        self.assertGreater(SS.MAX_CHANGED_FILES, 0)
        self.assertGreater(SS.MAX_PAGES_ADDED, 0)

    def test_expected_schedule_is_mon_wed_fri(self):
        self.assertEqual(SS.EXPECTED_SCHEDULE, "0 6 * * 1,3,5")

    def test_daily_automation_id_is_the_live_one(self):
        self.assertEqual(SS.DAILY_AUTOMATION, "1485d659-8663-4776-a507-db0fefed8483")


class TestCheckListMatchesPrompt(unittest.TestCase):
    """The live supervisor prompt names the checks; the script must implement them."""

    PROMPT = os.path.join(ROOT, "growth-engine", "automations",
                          "ai-headquarters-supervisor.prompt.md")

    def test_ai_visibility_blind_is_in_the_prompt(self):
        with open(self.PROMPT, encoding="utf-8") as fh:
            self.assertIn("ai_visibility_blind", fh.read())

    def test_script_implements_ai_visibility_blind(self):
        self.assertTrue(hasattr(SS, "check_ai_visibility_blind"))

    def test_prompt_check_table_names_every_script_check(self):
        with open(self.PROMPT, encoding="utf-8") as fh:
            text = fh.read()
        for name in ("automations_enabled", "schedule_intact", "prompt_matches_repo",
                     "ai_visibility_blind", "self_merges", "open_pr_backlog",
                     "change_volume", "unexpected_branches"):
            self.assertIn(f"`{name}`", text)


if __name__ == "__main__":
    unittest.main()
