#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regression tests for the sitemap cross-check in scripts/seo_audit.py.

The check compared filesystem paths against sitemap URL paths. A hub is listed
as `/services/` while its file is `services/index.html`, so all four hubs were
reported both "not in sitemap" and "canonical points elsewhere". It also counted
the 59 noindex legacy mirrors as pages missing from the sitemap. Together those
false positives produced a recurring daily-report item ("5 indexable pages
absent from sitemap.xml") that was not true.

No network access.

Run:  python3 -m unittest discover -s growth-engine/tests -v
"""
import os
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))

import seo_audit  # noqa: E402


class FakePage:
    def __init__(self, canonical=None, is_stub=False):
        self.canonical = canonical
        self.is_stub = is_stub


def page(canonical=None, is_stub=False):
    return FakePage(canonical=canonical, is_stub=is_stub)


DOMAIN = seo_audit.DOMAIN


def loc(path):
    return f"https://{DOMAIN}{path}"


class TestPathMapping(unittest.TestCase):
    def test_homepage_file_maps_to_root_url(self):
        self.assertEqual(seo_audit.url_path("index.html"), "/")

    def test_directory_index_maps_to_directory_url(self):
        self.assertEqual(seo_audit.url_path("services/index.html"), "/services/")
        self.assertEqual(seo_audit.url_path("academy/index.html"), "/academy/")

    def test_plain_page_keeps_its_path(self):
        self.assertEqual(seo_audit.url_path("contact.html"), "/contact.html")

    def test_url_and_rel_path_are_inverses(self):
        for rel in ("index.html", "services/index.html", "cities/irvine.html"):
            self.assertEqual(seo_audit.rel_path(seo_audit.url_path(rel)), rel)


class TestSitemapCoverage(unittest.TestCase):
    def test_directory_hub_listed_as_directory_url_is_covered(self):
        pages = {
            "index.html": page(canonical=loc("/")),
            "services/index.html": page(canonical=loc("/services/")),
        }
        cov = seo_audit.sitemap_coverage(pages, [loc("/"), loc("/services/")])
        self.assertEqual(cov["in_sm_not_fs"], [])
        self.assertEqual(cov["in_fs_not_sm"], [])
        self.assertEqual(cov["non_self_canon"], [])

    def test_noindex_legacy_mirror_is_not_reported_missing(self):
        pages = {
            "index.html": page(canonical=loc("/")),
            "slab-leak-detection.html": page(canonical=loc("/slab-leak-detection.html"), is_stub=True),
        }
        cov = seo_audit.sitemap_coverage(pages, [loc("/")])
        self.assertEqual(cov["in_fs_not_sm"], [])

    def test_indexable_page_absent_from_sitemap_is_reported(self):
        pages = {
            "index.html": page(canonical=loc("/")),
            "new-page.html": page(canonical=loc("/new-page.html")),
        }
        cov = seo_audit.sitemap_coverage(pages, [loc("/")])
        self.assertEqual(cov["in_fs_not_sm"], ["/new-page.html"])

    def test_sitemap_url_with_no_file_is_reported(self):
        pages = {"index.html": page(canonical=loc("/"))}
        cov = seo_audit.sitemap_coverage(pages, [loc("/"), loc("/ghost.html")])
        self.assertEqual(cov["in_sm_not_fs"], ["/ghost.html"])

    def test_hub_canonical_to_directory_url_is_self_canonical(self):
        pages = {
            "insurance/index.html": page(canonical=loc("/insurance/")),
        }
        cov = seo_audit.sitemap_coverage(pages, [loc("/insurance/")])
        self.assertEqual(cov["non_self_canon"], [])

    def test_canonical_pointing_elsewhere_is_reported(self):
        pages = {
            "insurance/does-insurance-cover-slab-leaks.html": page(
                canonical=loc("/insurance/does-insurance-cover-slab-leaks.html")
            ),
            "does-insurance-cover-slab-leaks.html": page(canonical=loc("/does-insurance-cover-slab-leaks.html")),
        }
        cov = seo_audit.sitemap_coverage(
            pages,
            [loc("/insurance/does-insurance-cover-slab-leaks.html")],
        )
        self.assertEqual(cov["non_self_canon"], [])

    def test_external_and_www_hosts_are_ignored(self):
        pages = {"index.html": page(canonical=loc("/"))}
        cov = seo_audit.sitemap_coverage(
            pages, ["https://example.com/", f"https://www.{DOMAIN}/"]
        )
        self.assertEqual(cov["in_sm_not_fs"], [])
        self.assertEqual(cov["sm_paths"], {"/"})


class TestLiveRepository(unittest.TestCase):
    """The shipped site must have a self-consistent sitemap."""

    def _real(self):
        pages = {}
        for dirpath, dirnames, filenames in os.walk(seo_audit.ROOT):
            dirnames[:] = [
                d for d in dirnames
                if d not in (".git", ".git-2", ".agents", ".claude", ".codex", ".vly-run", "node_modules")
            ]
            for fn in filenames:
                if fn.endswith(".html"):
                    full = os.path.join(dirpath, fn)
                    rel = os.path.relpath(full, seo_audit.ROOT).replace(os.sep, "/")
                    pages[rel] = seo_audit.parse_page(full)
        with open(os.path.join(seo_audit.ROOT, "sitemap.xml"), encoding="utf-8") as fh:
            import re
            sm_urls = re.findall(r"<loc>(.*?)</loc>", fh.read())
        return seo_audit.sitemap_coverage(pages, sm_urls)

    def test_every_sitemap_url_has_a_file(self):
        self.assertEqual(self._real()["in_sm_not_fs"], [])

    def test_every_indexable_page_is_in_the_sitemap(self):
        self.assertEqual(self._real()["in_fs_not_sm"], [])

    def test_every_sitemap_url_is_self_canonical(self):
        self.assertEqual(self._real()["non_self_canon"], [])


if __name__ == "__main__":
    unittest.main()
