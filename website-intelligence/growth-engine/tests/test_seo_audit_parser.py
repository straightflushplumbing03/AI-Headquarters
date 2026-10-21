#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Unit tests for the HTML parser and link resolver in scripts/seo_audit.py.

`PageParse` underpins every finding the audit produces — canonical checks, stub
detection, title/description length, image alt coverage, word count. It had no
direct tests; it was only exercised indirectly through the sitemap cross-check,
which never asserted what the parser itself captured. That meant a parser
regression (a tag it stopped recognising, or script text leaking into the word
count) could silently change audit output without failing anything.

Two properties here are load-bearing for the audit's correctness:

- `<script>` and `<style>` text must never reach `word_count` or `_text_chunks`.
  If it did, every page's word count would be inflated by its own JSON-LD and
  inline CSS, and thin-content detection would stop working.
- `norm_href` must map the same destination to the same string whether the href
  was written absolute or root-relative. When it does not, `sitemap_coverage`
  reports a healthy page as "canonical points elsewhere".

No network access.

Run:  python3 -m unittest discover -s growth-engine/tests -v
"""
import os
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts"))

import seo_audit  # noqa: E402


def parse(html):
    """Feed a snippet to PageParse the way parse_page does."""
    p = seo_audit.PageParse()
    p.feed(html)
    return p


class TestMetaExtraction(unittest.TestCase):
    def test_title_is_captured_verbatim(self):
        p = parse("<title>Plumber in Irvine</title>")
        self.assertEqual(p.title, "Plumber in Irvine")

    def test_robots_description_ogurl_and_viewport(self):
        p = parse(
            '<meta name="robots" content="index, follow">'
            '<meta name="description" content="A desc.">'
            '<meta property="og:url" content="https://x.com/a">'
            '<meta name="viewport" content="width=device-width">'
        )
        self.assertEqual(p.meta_robots, "index, follow")
        self.assertEqual(p.meta_desc, "A desc.")
        self.assertEqual(p.og_url, "https://x.com/a")
        self.assertEqual(p.viewport, "width=device-width")

    def test_canonical_link_is_captured(self):
        p = parse('<link rel="canonical" href="https://straightflushplumbingoc.com/irvine">')
        self.assertEqual(p.canonical, "https://straightflushplumbingoc.com/irvine")

    def test_absent_metadata_stays_none(self):
        p = parse("<title>t</title>")
        self.assertIsNone(p.canonical)
        self.assertIsNone(p.meta_robots)
        self.assertIsNone(p.meta_desc)
        self.assertIsNone(p.og_url)
        self.assertIsNone(p.viewport)


class TestHeadingExtraction(unittest.TestCase):
    def test_h1_whitespace_is_collapsed(self):
        p = parse("<h1>  Leak \n  Detection   Irvine </h1>")
        self.assertEqual(p.h1, ["Leak Detection Irvine"])

    def test_multiple_h1_are_all_recorded(self):
        p = parse("<h1>One</h1><h1>Two</h1>")
        self.assertEqual(p.h1, ["One", "Two"])

    def test_h2_is_truncated_to_120_chars(self):
        p = parse("<h2>" + "x" * 300 + "</h2>")
        self.assertEqual(len(p.h2[0]), 120)

    def test_h3_are_counted_not_stored(self):
        p = parse("<h3>a</h3><h3>b</h3>")
        self.assertEqual(p.h3, 2)


class TestImageAltTracking(unittest.TestCase):
    def test_images_without_alt_are_counted(self):
        p = parse('<img src="a.jpg" alt="ok"><img src="b.jpg"><img src="c.jpg" alt="">')
        self.assertEqual(p.imgs_total, 3)
        # An empty alt="" is a present attribute and is deliberately not counted
        # as missing; only a wholly absent alt counts.
        self.assertEqual(p.imgs_no_alt, 1)


class TestAnchorExtraction(unittest.TestCase):
    def test_non_navigational_hrefs_are_excluded_from_anchors(self):
        p = parse(
            '<a href="mailto:a@b.com">m</a>'
            '<a href="tel:+19493746524">t</a>'
            '<a href="javascript:void(0)">j</a>'
            '<a href="#frag">f</a>'
            '<a href="contact.html">real</a>'
        )
        self.assertEqual(p.anchors, ["contact.html"])

    def test_tel_link_sets_has_tel(self):
        p = parse('<a href="tel:+19493746524">Call</a>')
        self.assertTrue(p.has_tel)

    def test_no_tel_link_leaves_has_tel_false(self):
        p = parse('<a href="contact.html">Contact</a>')
        self.assertFalse(p.has_tel)

    def test_form_sets_has_form(self):
        self.assertTrue(parse("<form></form>").has_form)
        self.assertFalse(parse("<p>no form</p>").has_form)


class TestWordCount(unittest.TestCase):
    def test_counts_visible_words(self):
        p = parse("<p>Visible words here too.</p>")
        self.assertEqual(p.word_count(), 4)

    def test_script_text_is_excluded(self):
        p = parse("<script>var hidden = 'these must not count as words';</script>")
        self.assertEqual(p.word_count(), 0)

    def test_style_text_is_excluded(self):
        p = parse("<style>.a{color:red}</style>")
        self.assertEqual(p.word_count(), 0)

    def test_jsonld_text_is_excluded(self):
        p = parse('<script type="application/ld+json">{"@type":"Plumber"}</script>')
        self.assertEqual(p.word_count(), 0)

    def test_inline_script_between_visible_text_is_excluded(self):
        p = parse("<p>alpha beta</p><script>gamma delta epsilon</script><p>zeta</p>")
        self.assertEqual(p.word_count(), 3)

    def test_script_text_never_reaches_text_chunks(self):
        p = parse("<script>secret</script><style>colour</style><p>visible</p>")
        joined = " ".join(p._text_chunks)
        self.assertNotIn("secret", joined)
        self.assertNotIn("colour", joined)
        self.assertIn("visible", joined)


class TestJsonLdExtraction(unittest.TestCase):
    def _types(self, blob):
        return parse(f'<script type="application/ld+json">{blob}</script>').jsonld_types

    def test_single_object_type(self):
        self.assertEqual(self._types('{"@type":"Plumber"}'), ["Plumber"])

    def test_list_type_is_joined(self):
        self.assertEqual(self._types('{"@type":["Plumber","LocalBusiness"]}'), ["Plumber,LocalBusiness"])

    def test_graph_children_are_walked(self):
        self.assertEqual(
            self._types('{"@graph":[{"@type":"Plumber"},{"@type":"FAQPage"}]}'),
            ["Plumber", "FAQPage"],
        )

    def test_nested_children_are_walked(self):
        self.assertEqual(
            self._types('{"@type":"Service","provider":{"@type":"Plumber"}}'),
            ["Service", "Plumber"],
        )

    def test_invalid_json_is_recorded_not_raised(self):
        self.assertEqual(self._types("{not json"), ["<invalid-json>"])

    def test_multiple_blocks_accumulate(self):
        p = parse(
            '<script type="application/ld+json">{"@type":"Plumber"}</script>'
            '<script type="application/ld+json">{"@type":"FAQPage"}</script>'
        )
        self.assertEqual(p.jsonld_types, ["Plumber", "FAQPage"])


class TestParsePage(unittest.TestCase):
    def _write(self, html):
        d = tempfile.mkdtemp()
        path = os.path.join(d, "page.html")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(html)
        self.addCleanup(lambda: os.remove(path))
        return path

    def test_rel_is_repo_relative(self):
        page = seo_audit.parse_page(self._write("<title>t</title>"))
        self.assertTrue(page.rel.startswith(".."), page.rel)
        self.assertTrue(page.rel.endswith("page.html"))

    def test_raw_source_is_preserved(self):
        html = "<title>t</title><p>body</p>"
        self.assertEqual(seo_audit.parse_page(self._write(html)).raw, html)

    def test_title_is_stripped(self):
        page = seo_audit.parse_page(self._write("<title>  Spaced  </title>"))
        self.assertEqual(page.title, "Spaced")

    def test_noindex_is_a_stub(self):
        page = seo_audit.parse_page(self._write('<meta name="robots" content="noindex, follow">'))
        self.assertTrue(page.is_stub)

    def test_noindex_match_is_case_insensitive(self):
        page = seo_audit.parse_page(self._write('<meta name="robots" content="NOINDEX">'))
        self.assertTrue(page.is_stub)

    def test_indexable_page_is_not_a_stub(self):
        page = seo_audit.parse_page(self._write('<meta name="robots" content="index, follow">'))
        self.assertFalse(page.is_stub)

    def test_missing_robots_meta_is_not_a_stub(self):
        self.assertFalse(seo_audit.parse_page(self._write("<title>t</title>")).is_stub)

    def test_missing_file_raises(self):
        with self.assertRaises(OSError):
            seo_audit.parse_page(os.path.join(tempfile.gettempdir(), "does-not-exist-12345.html"))


class TestNormHref(unittest.TestCase):
    """Resolution of an href against the page it was found on."""

    PAGE = "cities/irvine.html"

    def test_external_host_returns_none(self):
        self.assertIsNone(seo_audit.norm_href("https://example.com/x", self.PAGE))

    def test_absolute_own_domain_becomes_site_relative(self):
        self.assertEqual(
            seo_audit.norm_href("https://straightflushplumbingoc.com/a.html", self.PAGE),
            "a.html",
        )

    def test_www_variant_of_own_domain_is_accepted(self):
        self.assertEqual(
            seo_audit.norm_href("https://www.straightflushplumbingoc.com/a.html", self.PAGE),
            "a.html",
        )

    def test_root_relative_path(self):
        self.assertEqual(seo_audit.norm_href("/services/", self.PAGE), "services/")

    def test_page_relative_path_resolves_against_page_directory(self):
        self.assertEqual(seo_audit.norm_href("x.html", self.PAGE), "cities/x.html")

    def test_fragment_is_stripped(self):
        self.assertEqual(seo_audit.norm_href("x.html#frag", self.PAGE), "cities/x.html")

    def test_query_string_is_stripped(self):
        self.assertEqual(seo_audit.norm_href("x.html?q=1", self.PAGE), "cities/x.html")

    def test_escaping_the_site_root_returns_none(self):
        self.assertIsNone(seo_audit.norm_href("../../x.html", self.PAGE))

    def test_escaping_from_root_page_returns_none(self):
        self.assertIsNone(seo_audit.norm_href("../x.html", "index.html"))

    def test_absolute_and_relative_directory_hrefs_agree(self):
        """Both spellings of a directory must resolve to the same site path.

        `norm_href` returns a value that `sitemap_coverage` then compares through
        `url_path`. If the absolute form keeps the trailing slash and the relative
        form loses it, the two produce `/services/` and `/services`, which are
        different strings for the same page, and the page is reported as having a
        canonical that points elsewhere.
        """
        absolute = seo_audit.norm_href("https://straightflushplumbingoc.com/services/", "index.html")
        relative = seo_audit.norm_href("services/", "index.html")
        self.assertEqual(absolute, "services/")
        self.assertEqual(relative, "services/", "relative directory href lost its trailing slash")

    def test_directory_href_from_subpage_agrees_with_absolute_form(self):
        absolute = seo_audit.norm_href("https://straightflushplumbingoc.com/services/", self.PAGE)
        relative = seo_audit.norm_href("../services/", self.PAGE)
        self.assertEqual(absolute, relative)


if __name__ == "__main__":
    unittest.main()
