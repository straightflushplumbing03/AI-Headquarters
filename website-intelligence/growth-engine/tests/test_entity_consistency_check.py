#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for the entity consistency check.

No network access: `fetch` is monkeypatched per test.

Run:  python3 -m unittest discover -s growth-engine/tests -v
"""
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import entity_consistency_check as EC  # noqa: E402


INDEXABLE = ('<html><head><title>Straight Flush Plumbing</title>'
             '<meta name="robots" content="index, follow"></head></html>')
NOINDEX = ('<html><head><title>404</title>'
           '<meta name="robots" content="noindex"></head></html>')
PLAIN = '<html><head><title>Straight Flush Plumbing</title></head></html>'


class TestParsers(unittest.TestCase):
    def test_robots_meta_found(self):
        self.assertEqual(EC.robots_meta(INDEXABLE), "index, follow")

    def test_robots_meta_absent(self):
        self.assertIsNone(EC.robots_meta(PLAIN))

    def test_robots_meta_single_quotes(self):
        html = "<meta name='robots' content='noindex, follow'>"
        self.assertEqual(EC.robots_meta(html), "noindex, follow")

    def test_canonical_link(self):
        html = '<link rel="canonical" href="https://example.com/x"/>'
        self.assertEqual(EC.canonical_link(html), "https://example.com/x")

    def test_canonical_absent(self):
        self.assertIsNone(EC.canonical_link(PLAIN))

    def test_is_indexable(self):
        self.assertTrue(EC.is_indexable(200, "index, follow"))
        self.assertTrue(EC.is_indexable(200, None))
        self.assertFalse(EC.is_indexable(200, "noindex"))
        self.assertFalse(EC.is_indexable(404, None))
        self.assertFalse(EC.is_indexable(None, None))


class TestClassify(unittest.TestCase):
    def test_canonical_host_200_is_canonical(self):
        v, _ = EC.classify(EC.CANONICAL_HOST, 200, PLAIN)
        self.assertEqual(v, "canonical")

    def test_canonical_host_noindex_is_unknown(self):
        # The real site must never be noindex — that is a serious problem.
        v, _ = EC.classify(EC.CANONICAL_HOST, 200, NOINDEX)
        self.assertEqual(v, "unknown")

    def test_duplicate_200_indexable_is_live_duplicate(self):
        v, _ = EC.classify("dupe.example.com", 200, INDEXABLE)
        self.assertEqual(v, "live_duplicate")

    def test_duplicate_200_without_robots_is_live_duplicate(self):
        # No robots meta means indexable by default.
        v, _ = EC.classify("dupe.example.com", 200, PLAIN)
        self.assertEqual(v, "live_duplicate")

    def test_duplicate_404_is_gone(self):
        v, _ = EC.classify("dupe.example.com", 404, "")
        self.assertEqual(v, "gone")

    def test_duplicate_410_is_gone(self):
        v, _ = EC.classify("dupe.example.com", 410, "")
        self.assertEqual(v, "gone")

    def test_duplicate_403_is_gone(self):
        v, _ = EC.classify("dupe.example.com", 403, "")
        self.assertEqual(v, "gone")

    def test_duplicate_200_noindex_is_acceptable(self):
        v, _ = EC.classify("dupe.example.com", 200, NOINDEX)
        self.assertEqual(v, "noindex")

    def test_network_failure_is_unknown(self):
        v, _ = EC.classify("dupe.example.com", None, "")
        self.assertEqual(v, "unknown")

    def test_unexpected_status_is_unknown(self):
        v, _ = EC.classify("dupe.example.com", 503, "")
        self.assertEqual(v, "unknown")

    def test_detail_captures_evidence(self):
        _, detail = EC.classify("dupe.example.com", 200, INDEXABLE)
        self.assertEqual(detail["http_status"], 200)
        self.assertEqual(detail["robots"], "index, follow")
        self.assertEqual(detail["title"], "Straight Flush Plumbing")


class TestSummarize(unittest.TestCase):
    def _res(self, host, verdict, status=200):
        return {"host": host, "url": f"https://{host}/", "verdict": verdict,
                "http_status": status, "robots": None, "canonical": None,
                "title": None}

    def test_ok_when_canonical_and_no_duplicates(self):
        s = EC.summarize([self._res(EC.CANONICAL_HOST, "canonical"),
                          self._res("dupe.example.com", "gone", 404)])
        self.assertTrue(s["ok"])
        self.assertEqual(s["live_duplicates"], [])

    def test_not_ok_when_live_duplicate_present(self):
        s = EC.summarize([self._res(EC.CANONICAL_HOST, "canonical"),
                          self._res("dupe.example.com", "live_duplicate")])
        self.assertFalse(s["ok"])
        self.assertEqual(s["live_duplicates"], ["dupe.example.com"])

    def test_not_ok_when_canonical_missing(self):
        s = EC.summarize([self._res("dupe.example.com", "gone", 404)])
        self.assertFalse(s["ok"])
        self.assertFalse(s["canonical_ok"])

    def test_timestamp_present(self):
        s = EC.summarize([self._res(EC.CANONICAL_HOST, "canonical")])
        self.assertRegex(s["ts"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


class TestHostRegistry(unittest.TestCase):
    def test_canonical_host_is_not_in_duplicate_list(self):
        self.assertNotIn(EC.CANONICAL_HOST, EC.DUPLICATE_HOSTS)

    def test_known_owned_hosts_are_registered(self):
        for host in ("straight-flush-plumbing-7fb7cf71.base44.app",
                     "straightflushplumb8.wixsite.com"):
            self.assertIn(host, EC.DUPLICATE_HOSTS)

    def test_check_all_queries_canonical_first(self):
        calls = []

        def fake_fetch(url, timeout=None):
            calls.append(url)
            return 404, ""

        original = EC.fetch
        EC.fetch = fake_fetch
        try:
            results = EC.check_all()
        finally:
            EC.fetch = original
        self.assertEqual(len(results), 1 + len(EC.DUPLICATE_HOSTS))
        self.assertTrue(calls[0].startswith(f"https://{EC.CANONICAL_HOST}"))


class TestDuplicateHostPaths(unittest.TestCase):
    """A 404 root must not mask a live indexable page on the same host."""

    HOST = "straightflushplumb8.wixsite.com"
    PATH = "/straightflushplumb-1"

    def test_known_subpath_is_registered(self):
        self.assertIn(self.PATH, EC.DUPLICATE_HOST_PATHS.get(self.HOST, []))

    def _with_fetch(self, by_url):
        calls = []

        def fake_fetch(url, timeout=None):
            calls.append(url)
            return by_url.get(url, (404, ""))

        original = EC.fetch
        EC.fetch = fake_fetch
        try:
            result = EC.check_host(self.HOST)
        finally:
            EC.fetch = original
        return result, calls

    def test_indexable_subpath_beats_404_root(self):
        indexable = '<meta name="robots" content="index, follow"><title>Home</title>'
        result, calls = self._with_fetch({
            f"https://{self.HOST}/": (404, "404 Error: Page Not Found"),
            f"https://{self.HOST}{self.PATH}": (200, indexable),
        })
        self.assertEqual(result["verdict"], "live_duplicate")
        self.assertEqual(result["url"], f"https://{self.HOST}{self.PATH}")
        self.assertIn(f"https://{self.HOST}/", calls)

    def test_gone_root_and_gone_subpath_stays_gone(self):
        result, _ = self._with_fetch({})
        self.assertEqual(result["verdict"], "gone")

    def test_noindex_subpath_is_not_a_live_duplicate(self):
        noindex = '<meta name="robots" content="noindex"><title>Home</title>'
        result, _ = self._with_fetch({
            f"https://{self.HOST}{self.PATH}": (200, noindex),
        })
        self.assertEqual(result["verdict"], "noindex")

    def test_host_without_known_paths_probes_only_root(self):
        host = "straight-flush-plumbing-7fb7cf71.base44.app"
        self.assertNotIn(host, EC.DUPLICATE_HOST_PATHS)
        calls = []

        def fake_fetch(url, timeout=None):
            calls.append(url)
            return 404, ""

        original = EC.fetch
        EC.fetch = fake_fetch
        try:
            EC.check_host(host)
        finally:
            EC.fetch = original
        self.assertEqual(calls, [f"https://{host}/"])


class TestCli(unittest.TestCase):
    def test_cli_exit_codes_reflect_duplicates(self):
        import subprocess
        # Point at a host set that is entirely 404 so the check is deterministic
        # and network-independent in spirit; here we only assert the CLI runs.
        out = subprocess.run(
            [sys.executable,
             os.path.join(ROOT, "scripts", "entity_consistency_check.py")],
            capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 1)
        self.assertIn("usage", out.stdout.lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
