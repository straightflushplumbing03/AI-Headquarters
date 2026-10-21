#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Guard the deployment contract for the master automation prompt.

The scheduled automation does not read `01-MASTER-AGENT-PROMPT.md` at run time —
OpenHands stores a copy of the prompt when the automation is created. That gap
caused real drift twice: the blueprint header advertised `0 6 * * *` while the
live job ran `0 6 * * 1,3,5`, and `build_payload.py` hardcoded the daily schedule
so a re-deploy would have silently reverted the live Mon/Wed/Fri job to daily.

These tests fail if the pieces that must agree stop agreeing, so the drift is
caught in CI instead of being discovered months later by reading the live API.

They do not call the network. The one thing they cannot check is whether the
*actually deployed* prompt still matches — only the live API knows that.
"""
import json
import os
import re
import subprocess
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BLUEPRINT = os.path.join(REPO_ROOT, "ai-headquarters-blueprint")
PROMPT_FILE = os.path.join(BLUEPRINT, "01-MASTER-AGENT-PROMPT.md")
BUILD_SCRIPT = os.path.join(BLUEPRINT, "build_payload.py")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TestPromptMarkers(unittest.TestCase):
    """build_payload.py extracts the prompt by regex; the markers must exist."""

    def setUp(self):
        self.text = read(PROMPT_FILE)

    def test_both_markers_present(self):
        self.assertIn("## THE PROMPT", self.text)
        self.assertIn("## END OF PROMPT", self.text)

    def test_marker_order_is_start_then_end(self):
        self.assertLess(self.text.index("## THE PROMPT"),
                        self.text.index("## END OF PROMPT"))

    def test_extracted_prompt_is_substantial(self):
        m = re.search(r"^## THE PROMPT.*?\n(.*?)^## END OF PROMPT", self.text, re.S | re.M)
        self.assertIsNotNone(m, "build_payload.py's regex did not match")
        self.assertGreater(len(m.group(1).strip()), 5000)


class TestMergePolicyRequiresReview(unittest.TestCase):
    """The owner requires review before merge; agents never merge.

    Policy history: an absolute 'Never merge your own pull request' ban came first
    (every run left its PR open forever). That was briefly relaxed to a scoped
    self-merge authority, then the owner asked for the opposite: open the PR,
    request a review, and let a human merge. These tests pin that final policy.
    """

    def setUp(self):
        self.text = read(PROMPT_FILE)

    def test_self_merge_authority_is_gone(self):
        self.assertNotIn("Merging your own pull request", self.text)

    def test_agents_are_told_never_to_merge(self):
        self.assertIn("never merge a pull request", self.text)

    def test_review_is_required_before_merge(self):
        low = self.text.lower()
        self.assertIn("request a review", low)
        self.assertIn("reviewed", low)

    def test_the_stop_instruction_is_present(self):
        # A run must not merge, enable auto-merge, or delete the branch.
        self.assertIn("do not enable auto-merge", self.text)

    def test_escalation_list_bans_all_merging(self):
        # §20 must read as an absolute ban, agreeing with §14.
        self.assertIn("- Merging any pull request.", self.text)

    def test_pr_body_must_carry_evidence(self):
        low = self.text.lower()
        self.assertIn("evidence", low)
        self.assertIn("verification commands", low)


class TestTestGateIsMandated(unittest.TestCase):
    """The daily run must gate on the unit suite, before and after a change."""

    def setUp(self):
        self.text = read(PROMPT_FILE)

    def test_unittest_discover_is_required(self):
        self.assertIn("unittest discover", self.text)

    def test_before_and_after_is_required(self):
        self.assertIn("before", self.text.lower())
        self.assertIn("revert", self.text.lower())

    def test_editing_a_failing_test_is_prohibited(self):
        low = self.text.lower()
        self.assertIn("do not edit the", low)


class TestScheduleHasOneSourceOfTruth(unittest.TestCase):
    def setUp(self):
        self.script = read(BUILD_SCRIPT)

    def test_schedule_constant_matches_the_live_job(self):
        self.assertIn('SCHEDULE = "0 6 * * 1,3,5"', self.script)

    def test_payload_uses_the_constant_not_a_literal(self):
        self.assertIn('"schedule": SCHEDULE', self.script)
        self.assertNotIn('"schedule": "0 6 * * *"', self.script)

    def test_timezone_follows_daylight_saving(self):
        self.assertIn('TIMEZONE = "America/Los_Angeles"', self.script)


class TestBuildPayloadMatchesContract(unittest.TestCase):
    """Actually run the builder and inspect the payload it produces."""

    @classmethod
    def setUpClass(cls):
        r = subprocess.run([sys.executable, BUILD_SCRIPT],
                           capture_output=True, text=True, cwd=REPO_ROOT)
        if r.returncode != 0:
            raise AssertionError(f"build_payload.py failed:\n{r.stderr}")
        with open("/tmp/payload.json", encoding="utf-8") as fh:
            cls.payload = json.load(fh)

    def test_trigger_schedule_and_timezone(self):
        self.assertEqual(self.payload["trigger"]["schedule"], "0 6 * * 1,3,5")
        self.assertEqual(self.payload["trigger"]["timezone"], "America/Los_Angeles")

    def test_timeout_is_within_the_effective_ceiling(self):
        # The platform kills runs near ~1920 s regardless, so the config must not
        # promise more time than a run can actually use.
        self.assertLessEqual(self.payload["timeout"], 1920)

    def test_both_repositories_are_attached(self):
        urls = [r["url"] for r in self.payload["repos"]]
        self.assertIn("https://github.com/straightflushplumbing03/AI-Headquarters", urls)
        self.assertIn("https://github.com/straightflushplumbing03/-Up2datewebsiteseo", urls)
        for r in self.payload["repos"]:
            self.assertEqual(r["ref"], "main")

    def test_prompt_is_inside_the_platform_limit(self):
        # The preset rejects prompts over 50,000 chars.
        self.assertGreater(len(self.payload["prompt"]), 5000)
        self.assertLess(len(self.payload["prompt"]), 50000)


class TestDeployIsGuarded(unittest.TestCase):
    """--deploy must not be the default, and must need a credential."""

    def setUp(self):
        self.script = read(BUILD_SCRIPT)

    def test_deploy_is_opt_in(self):
        self.assertIn('"--deploy"', self.script)
        self.assertIn("dry run", self.script)

    def test_deploy_requires_api_key(self):
        self.assertIn("OPENHANDS_API_KEY", self.script)


if __name__ == "__main__":
    unittest.main()
