"""Guards the GA4 tag and the CSP that lets it run.

The tag is easy to get wrong in ways that still look correct in the markup:

  * the snippet loads from googletagmanager.com and calls an inline function,
    both of which `script-src 'self'` blocks;
  * it then beacons to google-analytics.com, which `connect-src 'self'` blocks.

In all three cases the tag stays in the HTML and reports nothing, so the page
looks instrumented while GA4 receives no hits. These tests fail if the tag is
missing or duplicated, if the CSP stops allowing what the tag needs, or if the
inline hash no longer matches the snippet the pages actually contain.
"""

import base64
import hashlib
import os
import re
import sys
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from csp_policy import GTAG_BLOCK, MEASUREMENT_ID, csp_content  # noqa: E402
import add_security_meta  # noqa: E402
import cloudflare_add_security_headers as cf  # noqa: E402

SCAN_DIRS = ["", "about", "academy", "cities", "services", "insurance",
             "case-studies", "guides"]

GTAG_LOADER = (
    r'<script async src="https://www\.googletagmanager\.com/gtag/js\?id='
    + MEASUREMENT_ID + r'"></script>\s*<script>(.*?)</script>'
)


def pages():
    for d in SCAN_DIRS:
        base = os.path.join(ROOT, d) if d else ROOT
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            if name.endswith(".html"):
                yield os.path.join(base, name)


class TestTagPresent(unittest.TestCase):
    def test_every_page_has_exactly_one_tag(self):
        missing, dup = [], []
        for p in pages():
            with open(p, encoding="utf-8") as fh:
                n = fh.read().count("Google tag (gtag.js)")
            if n == 0:
                missing.append(os.path.relpath(p, ROOT))
            elif n > 1:
                dup.append((os.path.relpath(p, ROOT), n))
        self.assertEqual(missing, [], "pages with no Google tag")
        self.assertEqual(dup, [], "pages with more than one Google tag")

    def test_tag_sits_immediately_after_head(self):
        for p in pages():
            with open(p, encoding="utf-8") as fh:
                s = fh.read()
            head = s.index("<head>") + len("<head>")
            rest = s[head:].lstrip("\r\n")
            self.assertTrue(
                rest.startswith("<!-- Google tag (gtag.js) -->"),
                "%s: tag is not the first thing after <head>" % os.path.relpath(p, ROOT),
            )

    def test_measurement_id_is_the_expected_one(self):
        self.assertEqual(MEASUREMENT_ID, "G-DFS6B1LV4P")
        self.assertIn(MEASUREMENT_ID, GTAG_BLOCK)


class TestCspAllowsTag(unittest.TestCase):
    def test_csp_allows_the_three_things_the_tag_needs(self):
        csp = csp_content()
        self.assertIn("https://www.googletagmanager.com", csp)  # script + connect
        self.assertIn("https://*.google-analytics.com", csp)    # beacons
        # script-src must no longer be bare 'self'
        script = re.search(r"script-src ([^;]*);", csp).group(1)
        self.assertNotEqual(script.strip(), "'self'")

    def test_policy_is_not_weakened_to_unsafe_inline(self):
        """The inline bootstrap is hash-allowed, so XSS protection stays."""
        self.assertNotIn("'unsafe-inline'", csp_content())
        self.assertIn("'sha256-", csp_content())

    def test_every_page_csp_matches_the_shared_policy(self):
        expected = csp_content()
        for p in pages():
            with open(p, encoding="utf-8") as fh:
                s = fh.read()
            m = re.search(r'Content-Security-Policy" content="([^"]*)"', s)
            self.assertIsNotNone(m, "%s has no meta CSP" % os.path.relpath(p, ROOT))
            self.assertEqual(m.group(1), expected, "%s: stale CSP" % os.path.relpath(p, ROOT))


class TestHashMatchesSnippet(unittest.TestCase):
    def _computed(self, inline):
        return base64.b64encode(hashlib.sha256(inline.encode()).digest()).decode()

    def test_hash_matches_what_the_pages_contain(self):
        csp = csp_content()
        for p in pages():
            with open(p, encoding="utf-8") as fh:
                s = fh.read()
            m = re.search(GTAG_LOADER, s, re.S)
            self.assertIsNotNone(m, "%s: snippet not matched" % os.path.relpath(p, ROOT))
            token = "'sha256-%s'" % self._computed(m.group(1))
            self.assertIn(token, csp,
                          "%s: CSP hash does not cover this page's snippet" % os.path.relpath(p, ROOT))

    def test_hash_matches_the_template(self):
        start = GTAG_BLOCK.index("<script>\n") + len("<script>")
        end = GTAG_BLOCK.rindex("</script>")
        token = "'sha256-%s'" % self._computed(GTAG_BLOCK[start:end])
        self.assertIn(token, csp_content())


class TestCspSourcesStayInSync(unittest.TestCase):
    """Three emitters; if one drifts, the tag can break silently."""

    def test_all_emitters_use_the_shared_policy(self):
        shared = csp_content()
        self.assertEqual(add_security_meta.CSP_CONTENT, shared)
        self.assertEqual(cf.HEADERS["Content-Security-Policy"], shared)

    def test_security_meta_rerun_does_not_revert_the_ga_allowlist(self):
        """Regression: this script used to write a CSP with script-src 'self'."""
        self.assertIn("googletagmanager.com", add_security_meta.META_CSP)

    def test_no_script_inlines_unsafe_policy(self):
        for path, needle in [
            ("scripts/build.py", "script-src 'self' https://cdnjs.cloudflare.com"),
        ]:
            with open(os.path.join(ROOT, path), encoding="utf-8") as fh:
                src = fh.read()
            self.assertNotIn(needle, src, "%s still has an inline stale CSP" % path)


if __name__ == "__main__":
    unittest.main()
