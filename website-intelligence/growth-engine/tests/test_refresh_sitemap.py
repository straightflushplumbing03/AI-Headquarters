#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regression tests for the sitemap lastmod refresh.

The tool used to stamp every URL with today's date inside a shallow clone:
`git log` reports the grafted fetch date for every path there, and the mtime
fallback is equally useless because every file carries the clone's mtime.
Both signals say "changed today" for files nobody touched.

No network access. A real `git clone --depth 1` fixture exercises the shallow
path; an unshallowable plain repo exercises the normal path.

Run:  python3 -m unittest discover -s growth-engine/tests -v
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT = os.path.join(ROOT, "scripts", "refresh_sitemap.py")

INDEXABLE = (
    '<html><head><title>Straight Flush Plumbing</title>'
    '<meta name="robots" content="index, follow"></head><body>x</body></html>'
)
SITEMAP = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://straightflushplumbingoc.com/</loc>
    <lastmod>2026-01-02</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://straightflushplumbingoc.com/contact.html</loc>
    <lastmod>2026-01-02</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>
</urlset>
"""


def _git(cwd, *args, env=None):
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, env=env, check=True
    )


def _lastmods(root):
    with open(os.path.join(root, "sitemap.xml"), encoding="utf-8") as fh:
        return re.findall(r"<lastmod>(.*?)</lastmod>", fh.read())


class SitemapLastmodTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="sitemap-test-")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.env = dict(os.environ)
        self.env.update({
            "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
            "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com",
            "GIT_AUTHOR_DATE": "2026-01-02T00:00:00", "GIT_COMMITTER_DATE": "2026-01-02T00:00:00",
        })

    def _seed_repo(self, name):
        src = os.path.join(self.tmp, name)
        os.makedirs(src)
        for fn in ("index.html", "contact.html"):
            with open(os.path.join(src, fn), "w", encoding="utf-8") as fh:
                fh.write(INDEXABLE)
        with open(os.path.join(src, "sitemap.xml"), "w", encoding="utf-8") as fh:
            fh.write(SITEMAP)
        _git(src, "init", "-q", env=self.env)
        _git(src, "add", "-A", env=self.env)
        _git(src, "commit", "-qm", "seed", env=self.env)
        return src

    def _run_tool(self, root):
        scripts = os.path.join(root, "scripts")
        os.makedirs(scripts, exist_ok=True)
        shutil.copy(SCRIPT, os.path.join(scripts, "refresh_sitemap.py"))
        return subprocess.run(
            [sys.executable, os.path.join("scripts", "refresh_sitemap.py")],
            cwd=root, capture_output=True, text=True,
        )

    def test_shallow_clone_does_not_rewrite_lastmod(self):
        src = self._seed_repo("src")
        clone = os.path.join(self.tmp, "shallow")
        _git(self.tmp, "clone", "-q", "--depth", "1", f"file://{src}", clone, env=self.env)
        self.assertEqual(
            _git(clone, "rev-parse", "--is-shallow-repository").stdout.strip(), "true"
        )

        result = self._run_tool(clone)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("history unavailable", result.stdout)
        self.assertEqual(_lastmods(clone), ["2026-01-02", "2026-01-02"])

    def test_shallow_clone_still_bumps_a_modified_page(self):
        src = self._seed_repo("src")
        clone = os.path.join(self.tmp, "shallow")
        _git(self.tmp, "clone", "-q", "--depth", "1", f"file://{src}", clone, env=self.env)
        with open(os.path.join(clone, "contact.html"), "a", encoding="utf-8") as fh:
            fh.write("<!-- edit -->")

        result = self._run_tool(clone)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("lastmod refreshed: 1", result.stdout)
        index_lm, contact_lm = _lastmods(clone)
        self.assertEqual(index_lm, "2026-01-02")
        self.assertNotEqual(contact_lm, "2026-01-02")

    def test_url_set_is_stable_in_shallow_clone(self):
        src = self._seed_repo("src")
        clone = os.path.join(self.tmp, "shallow")
        _git(self.tmp, "clone", "-q", "--depth", "1", f"file://{src}", clone, env=self.env)

        result = self._run_tool(clone)

        self.assertIn("to add: 0", result.stdout)
        self.assertIn("to remove: 0", result.stdout)
        self.assertIn("Sitemap is in sync", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
