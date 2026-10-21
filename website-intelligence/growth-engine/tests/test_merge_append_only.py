"""Tests for scripts/merge_append_only.py.

The failure this guards against is silent data loss: a merge resolution that
keeps one side of an append-only file and discards entries that exist only on
the other. That already happened once on a real branch, so every test asserts
that content from BOTH sides survives.
"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))

import merge_append_only as m


def rec(ts, q):
    return json.dumps({"ts": ts, "query": q})


class TestJsonlUnion(unittest.TestCase):
    def test_keeps_entries_from_both_sides(self):
        ours = rec("2026-10-12T10:00:00Z", "a")
        theirs = rec("2026-10-11T10:00:00Z", "b")
        out = m.union_jsonl(ours, theirs)
        lines = [json.loads(l) for l in out.splitlines()]
        self.assertEqual({r["query"] for r in lines}, {"a", "b"})

    def test_sorts_by_ts_ascending(self):
        ours = rec("2026-10-12T10:00:00Z", "later")
        theirs = rec("2026-10-10T10:00:00Z", "earlier")
        out = m.union_jsonl(ours, theirs)
        self.assertEqual(
            [json.loads(l)["query"] for l in out.splitlines()], ["earlier", "later"]
        )

    def test_deduplicates_identical_records(self):
        same = rec("2026-10-12T10:00:00Z", "dup")
        out = m.union_jsonl(same, same)
        self.assertEqual(len(out.splitlines()), 1)

    def test_keeps_same_ts_different_content(self):
        """Two records can share a timestamp; neither may be dropped."""
        ours = rec("2026-10-12T10:00:00Z", "one")
        theirs = rec("2026-10-12T10:00:00Z", "two")
        out = m.union_jsonl(ours, theirs)
        self.assertEqual(len(out.splitlines()), 2)

    def test_skips_unparsable_lines(self):
        text = rec("2026-10-12T10:00:00Z", "a") + "\nnot json\n"
        self.assertEqual([r["query"] for r in m.load_jsonl_text(text)], ["a"])


class TestParseConflicts(unittest.TestCase):
    def test_splits_clean_text_without_conflicts(self):
        segments = m.parse_conflicts("hello\nworld\n")
        self.assertEqual(segments, [("text", "hello\nworld\n")])

    def test_extracts_both_sides_of_a_conflict(self):
        text = (
            "before\n"
            "<<<<<<< HEAD\nours line\n=======\ntheirs line\n>>>>>>> origin/x\n"
            "after\n"
        )
        segments = m.parse_conflicts(text)
        self.assertEqual(segments[0], ("text", "before\n"))
        self.assertEqual(segments[1], ("conflict", "ours line\n", "theirs line\n"))
        self.assertEqual(segments[2], ("text", "after\n"))

    def test_handles_two_conflicts_in_one_file(self):
        text = (
            "<<<<<<< HEAD\na1\n=======\nb1\n>>>>>>> x\n"
            "middle\n"
            "<<<<<<< HEAD\na2\n=======\nb2\n>>>>>>> x\n"
        )
        segments = m.parse_conflicts(text)
        self.assertEqual(sum(1 for s in segments if s[0] == "conflict"), 2)
        self.assertEqual([s[1] for s in segments if s[0] == "conflict"], ["a1\n", "a2\n"])


class TestResolveFile(unittest.TestCase):
    """The regression that matters: a conflicted file must never come out still
    containing markers, and both sides' content must survive."""

    def _write(self, body, suffix):
        import tempfile

        with tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False) as fh:
            fh.write(body)
            return fh.name

    def test_jsonl_conflict_keeps_both_sides(self):
        path = self._write(
            "<<<<<<< HEAD\n"
            + rec("2026-10-12T10:00:00Z", "ours")
            + "\n=======\n"
            + rec("2026-10-11T10:00:00Z", "theirs")
            + "\n>>>>>>> origin/x\n",
            ".jsonl",
        )
        try:
            out = m.resolve_file(path)
        finally:
            os.unlink(path)
        self.assertNotIn("<<<<<<<", out)
        self.assertNotIn("=======", out)
        self.assertNotIn(">>>>>>>", out)
        self.assertEqual(
            {json.loads(l)["query"] for l in out.splitlines()}, {"ours", "theirs"}
        )

    def test_markdown_conflict_keeps_both_sections(self):
        path = self._write(
            "# Log\n\n<<<<<<< HEAD\n"
            "## 2026-10-12 - ours\n\nours body\n"
            "=======\n"
            "## 2026-10-11 - theirs\n\ntheirs body\n"
            ">>>>>>> origin/x\n",
            ".md",
        )
        try:
            out = m.resolve_file(path)
        finally:
            os.unlink(path)
        self.assertIn("ours body", out)
        self.assertIn("theirs body", out)
        for marker in ("<<<<<<<", "=======", ">>>>>>>"):
            self.assertNotIn(marker, out)

    def test_clean_file_is_returned_unchanged(self):
        body = "# Log\n\n## 2026-10-12 - entry\n\nbody\n"
        path = self._write(body, ".md")
        try:
            self.assertEqual(m.resolve_file(path), body)
        finally:
            os.unlink(path)

    def test_guard_raises_if_markers_would_remain(self):
        """A nested/malformed marker must fail loudly, not be written out."""
        path = self._write(
            "<<<<<<< HEAD\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> a\n=======\nz\n>>>>>>> b\n",
            ".md",
        )
        try:
            with self.assertRaises(m.ConflictMarkersRemain):
                m.resolve_file(path)
        finally:
            os.unlink(path)

    def test_out_file_is_written_and_clean(self):
        import tempfile

        path = self._write(
            "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\n", ".md"
        )
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as fh:
            out_path = fh.name
        try:
            m.resolve_file(path, out=out_path)
            with open(out_path, encoding="utf-8") as fh:
                written = fh.read()
            self.assertNotIn("<<<<<<<", written)
        finally:
            os.unlink(path)
            os.unlink(out_path)


class TestMarkdownUnion(unittest.TestCase):
    OURS = (
        "# Log\n\n"
        "## 2026-10-15 (third run) - newest entry\n\nours newest body\n\n"
        "## 2026-10-12 (Phase 2) - shared heading\n\nours shared body\n"
    )
    THEIRS = (
        "# Log\n\n"
        "## 2026-10-12 (Phase 2) - shared heading\n\ntheirs shared body\n\n"
        "## 2026-10-12 (HQ-D run #2) - only on theirs\n\ntheirs unique body\n"
    )

    def test_keeps_sections_unique_to_either_side(self):
        out = m.union_markdown(self.OURS, self.THEIRS)
        self.assertIn("ours newest body", out)
        self.assertIn("theirs unique body", out)

    def test_orders_newest_first(self):
        out = m.union_markdown(self.OURS, self.THEIRS)
        self.assertLess(out.index("2026-10-15"), out.index("2026-10-12"))

    def test_ours_wins_on_heading_collision(self):
        out = m.union_markdown(self.OURS, self.THEIRS)
        self.assertIn("ours shared body", out)
        self.assertNotIn("theirs shared body", out)

    def test_preamble_is_not_duplicated(self):
        out = m.union_markdown(self.OURS, self.THEIRS)
        self.assertEqual(out.count("# Log"), 1)

    def test_no_conflict_markers_survive(self):
        out = m.union_markdown(self.OURS, self.THEIRS)
        for marker in ("<<<<<<<", "=======", ">>>>>>>"):
            self.assertNotIn(marker, out)


if __name__ == "__main__":
    unittest.main()
