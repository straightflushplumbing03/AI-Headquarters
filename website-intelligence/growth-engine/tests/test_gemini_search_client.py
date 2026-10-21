#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for the Gemini Search-grounded client.

No network access and no API key required: every test uses a fake opener, so the
suite is safe to run in CI and by the daily automation.

Run:  python3 -m unittest discover -s growth-engine/tests -v
"""
import io
import json
import os
import sys
import unittest
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "growth-engine"))

import gemini_search_client as G  # noqa: E402


def _body(answer, queries=None, chunks=None, finish="STOP"):
    return {
        "candidates": [{
            "finishReason": finish,
            "content": {"parts": [{"text": answer}]},
            "groundingMetadata": {
                "webSearchQueries": queries or ["plumber laguna niguel"],
                "groundingChunks": [{"web": c} for c in (chunks or [])],
            },
        }],
        "usageMetadata": {"promptTokenCount": 12, "candidatesTokenCount": 88,
                          "totalTokenCount": 100},
    }


class FakeResponse(io.BytesIO):
    def __init__(self, obj):
        super().__init__(json.dumps(obj).encode("utf-8"))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeOpener:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def __call__(self, req, timeout=None):
        self.calls.append(req)
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return FakeResponse(item)


def _http_error(code, body, retry_after=None):
    hdrs = {"Content-Type": "application/json"}
    if retry_after is not None:
        hdrs["Retry-After"] = str(retry_after)
    fp = io.BytesIO(json.dumps(body).encode("utf-8"))
    return urllib.error.HTTPError(
        "https://x", code, "err", type("H", (), {"get": lambda s, k, d=None: hdrs.get(k)})(), fp)


class KeyTests(unittest.TestCase):
    def setUp(self):
        self._saved = {k: os.environ.pop(k, None) for k in G.API_KEY_ENV_VARS}

    def tearDown(self):
        for k, v in self._saved.items():
            if v is not None:
                os.environ[k] = v

    def test_present_false_when_unset(self):
        self.assertFalse(G.api_key_present())

    def test_present_true_when_set(self):
        os.environ["GEMINI_API_KEY"] = "abc"
        self.assertTrue(G.api_key_present())

    def test_present_true_for_platform_cased_secret(self):
        os.environ["Gemini_api_key"] = "abc"
        self.assertTrue(G.api_key_present())

    def test_canonical_name_wins(self):
        os.environ["Gemini_api_key"] = "lower"
        os.environ["GEMINI_API_KEY"] = "upper"
        self.assertEqual(G._env_api_key(), "upper")

    def test_missing_key_raises_authentication_failed(self):
        with self.assertRaises(G.GeminiError) as ctx:
            G.GeminiClient().ask("q")
        self.assertEqual(ctx.exception.error_type, "authentication_failed")

    def test_error_dict_never_contains_key(self):
        client = G.GeminiClient(api_key="super-secret", opener=FakeOpener([
            _http_error(401, {"error": {"status": "UNAUTHENTICATED"}})]))
        try:
            client.ask("q")
            self.fail("expected")
        except G.GeminiError as exc:
            self.assertNotIn("super-secret", json.dumps(exc.as_dict()))


class ErrorTaxonomyTests(unittest.TestCase):
    def test_unauthenticated_maps_to_auth(self):
        self.assertEqual(G._error_type_for(401, "UNAUTHENTICATED"),
                         "authentication_failed")

    def test_resource_exhausted_maps_to_rate_limited(self):
        self.assertEqual(G._error_type_for(429, "RESOURCE_EXHAUSTED"), "rate_limited")

    def test_invalid_argument_maps_to_bad_request(self):
        self.assertEqual(G._error_type_for(400, "INVALID_ARGUMENT"), "bad_request")

    def test_availability_maps_to_server_error(self):
        self.assertEqual(G._error_type_for(503, "UNAVAILABLE"), "server_error")

    def test_status_only_fallback(self):
        self.assertEqual(G._error_type_for(500), "server_error")
        self.assertEqual(G._error_type_for(429), "rate_limited")

    def test_every_type_in_taxonomy(self):
        for code in (401, 403, 429, 400, 404, 422, 500, 503, 999):
            self.assertIn(G._error_type_for(code), G.ERROR_TYPES)


class ClassifyTests(unittest.TestCase):
    def test_absent_when_not_mentioned(self):
        self.assertEqual(G.classify_visibility("Try Bob's Plumbing.", [], []), "absent")

    def test_cited_when_sf_url_in_sources(self):
        src = [{"url": "https://straightflushplumbingoc.com/x"}]
        self.assertEqual(G.classify_visibility("Yes.", src, []), "cited")

    def test_recommended(self):
        txt = "I recommend Straight Flush Plumbing & Leak Detection for that."
        self.assertEqual(G.classify_visibility(txt, [], []), "recommended")

    def test_mentioned_without_recommendation(self):
        txt = "Straight Flush Plumbing & Leak Detection also serves the area."
        self.assertEqual(G.classify_visibility(txt, [], []), "mentioned")

    def test_empty_is_inconclusive(self):
        self.assertEqual(G.classify_visibility("", [], []), "inconclusive")

    def test_never_returns_incorrect(self):
        for txt in ("Straight Flush Plumbing is bad", "Straight Flush Plumbing"):
            self.assertNotEqual(G.classify_visibility(txt, [], []), "incorrect")


class NormaliseTests(unittest.TestCase):
    def test_extracts_answer_sources_queries_usage(self):
        client = G.GeminiClient(api_key="k", opener=FakeOpener([_body(
            "Straight Flush Plumbing is a good choice.",
            chunks=[{"uri": "https://straightflushplumbingoc.com/a", "title": "SF"},
                    {"uri": "https://other.com/b", "title": "O"}])]))
        r = client.ask("q")
        self.assertTrue(r["ok"])
        self.assertIn("Straight Flush", r["answer"])
        self.assertEqual(len(r["sources"]), 2)
        self.assertEqual(r["domains"], ["straightflushplumbingoc.com", "other.com"])
        self.assertEqual(r["search_queries"], ["plumber laguna niguel"])
        self.assertEqual(r["usage"]["totalTokenCount"], 100)

    def test_dedupes_sources(self):
        client = G.GeminiClient(api_key="k", opener=FakeOpener([_body(
            "a", chunks=[{"uri": "https://x.com/1"}, {"uri": "https://x.com/1"}])]))
        self.assertEqual(len(client.ask("q")["sources"]), 1)

    def test_no_grounding_chunks_is_empty_not_error(self):
        client = G.GeminiClient(api_key="k", opener=FakeOpener([_body("no sources", chunks=[])]))
        r = client.ask("q")
        self.assertEqual(r["sources"], [])
        self.assertEqual(r["domains"], [])


class RequestTests(unittest.TestCase):
    def test_sends_search_tool_and_key_header(self):
        opener = FakeOpener([_body("ok")])
        client = G.GeminiClient(api_key="k", model="gemini-2.5-flash", opener=opener)
        client.ask("q")
        req = opener.calls[0]
        payload = json.loads(req.data.decode("utf-8"))
        self.assertEqual(payload["tools"], [{"google_search": {}}])
        self.assertEqual(req.headers.get("X-goog-api-key"), "k")
        self.assertIn("gemini-2.5-flash:generateContent", req.full_url)


class RetryTests(unittest.TestCase):
    def test_retries_rate_limit_then_succeeds(self):
        opener = FakeOpener([
            _http_error(429, {"error": {"status": "RESOURCE_EXHAUSTED"}}, retry_after=1),
            _body("recovered")])
        client = G.GeminiClient(api_key="k", opener=opener, sleep=lambda s: None)
        self.assertTrue(client.ask("q")["ok"])
        self.assertEqual(len(opener.calls), 2)

    def test_honours_retry_after(self):
        slept = []
        opener = FakeOpener([
            _http_error(429, {"error": {"status": "RESOURCE_EXHAUSTED"}}, retry_after=7),
            _body("ok")])
        G.GeminiClient(api_key="k", opener=opener, sleep=slept.append).ask("q")
        self.assertEqual(slept, [7])

    def test_gives_up_after_max_retries(self):
        opener = FakeOpener([_http_error(500, {"error": {"status": "INTERNAL"}})] * 3)
        client = G.GeminiClient(api_key="k", opener=opener, max_retries=3,
                                sleep=lambda s: None)
        with self.assertRaises(G.GeminiError):
            client.ask("q")
        self.assertEqual(len(opener.calls), 3)

    def test_does_not_retry_bad_request(self):
        opener = FakeOpener([_http_error(400, {"error": {"status": "INVALID_ARGUMENT"}})])
        client = G.GeminiClient(api_key="k", opener=opener, sleep=lambda s: None)
        with self.assertRaises(G.GeminiError):
            client.ask("q")
        self.assertEqual(len(opener.calls), 1)

    def test_does_not_retry_auth(self):
        opener = FakeOpener([_http_error(403, {"error": {"status": "PERMISSION_DENIED"}})])
        client = G.GeminiClient(api_key="k", opener=opener, sleep=lambda s: None)
        with self.assertRaises(G.GeminiError):
            client.ask("q")
        self.assertEqual(len(opener.calls), 1)


class RecordTests(unittest.TestCase):
    def test_success_record_matches_jsonl_schema(self):
        result = {"ok": True, "model": "gemini-2.5-flash", "answer": "Straight Flush Plumbing rocks",
                  "sources": [{"url": "https://straightflushplumbingoc.com/a"}],
                  "citations": [{"url": "https://straightflushplumbingoc.com/a"}],
                  "domains": ["straightflushplumbingoc.com"], "search_queries": ["q"],
                  "usage": {"totalTokenCount": 5}}
        rec = G.build_record("plumber", "Laguna Niguel", result)
        for field in ("ts", "platform", "test_type", "query", "city", "web_search",
                      "straight_flush", "top_results", "confidence", "note"):
            self.assertIn(field, rec)
        self.assertEqual(rec["platform"], "gemini_search")
        self.assertEqual(rec["test_type"], "ai_platform")
        self.assertEqual(rec["straight_flush"], "cited")
        self.assertNotIn("answer", rec)  # full answer is never stored

    def test_failure_record_is_inconclusive_not_absent(self):
        rec = G.build_record("q", "c", {"ok": False, "error_type": "rate_limited",
                                        "status_code": 429, "message": "slow down"})
        self.assertEqual(rec["straight_flush"], "inconclusive")
        self.assertEqual(rec["test_type"], "test_failure")
        self.assertEqual(rec["error_type"], "rate_limited")

    def test_unknown_error_type_falls_back(self):
        rec = G.build_record("q", "c", {"ok": False, "error_type": "weird"})
        self.assertEqual(rec["error_type"], "unknown_error")

    def test_record_never_contains_key(self):
        rec = G.build_record("q", "c", {"ok": True, "answer": "x", "model": "m"})
        self.assertNotIn("key", json.dumps(rec).lower())

    def test_appends_jsonl_lines(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "sub", "h.jsonl")
            n = G.append_records(path, [{"a": 1}, {"b": 2}])
            self.assertEqual(n, 2)
            with open(path) as fh:
                self.assertEqual(len(fh.read().strip().splitlines()), 2)


class ModelChainTests(unittest.TestCase):
    """A slug Google retires must not zero the day's AI sweep.

    `gemini-2.5-flash` began answering 404 "no longer available to new users",
    which made every grounded query inconclusive.
    """

    def test_default_model_is_the_stable_latest_alias(self):
        self.assertEqual(G.DEFAULT_MODEL, "gemini-flash-latest")

    def test_retired_default_slug_is_not_reinstated(self):
        self.assertNotEqual(G.DEFAULT_MODEL, "gemini-2.5-flash")

    def test_default_chain_starts_with_default_and_is_unique(self):
        client = G.GeminiClient(api_key="k", opener=FakeOpener([]))
        self.assertEqual(client._models[0], G.DEFAULT_MODEL)
        self.assertEqual(len(client._models), len(set(client._models)))
        self.assertIn("gemini-2.5-flash", client._models)

    def test_explicit_model_pins_a_single_slug(self):
        client = G.GeminiClient(api_key="k", model="gemini-3.5-flash",
                                opener=FakeOpener([]))
        self.assertEqual(client._models, ["gemini-3.5-flash"])

    def test_env_model_pins_a_single_slug(self):
        os.environ["GEMINI_MODEL"] = "gemini-3.5-flash"
        try:
            client = G.GeminiClient(api_key="k", opener=FakeOpener([]))
            self.assertEqual(client._models, ["gemini-3.5-flash"])
        finally:
            del os.environ["GEMINI_MODEL"]

    def test_falls_back_when_a_slug_is_retired(self):
        opener = FakeOpener([
            _http_error(404, {"error": {"status": "NOT_FOUND",
                                        "message": "model is no longer available to new users"}}),
            _body("plumber found"),
        ])
        client = G.GeminiClient(api_key="k", opener=opener, sleep=lambda s: None,
                                model_fallbacks=["gemini-3.8-flash"])
        result = client.ask("q")
        self.assertTrue(result["ok"])
        self.assertEqual(len(opener.calls), 2)
        self.assertIn("gemini-3.8-flash", opener.calls[1].full_url)

    def test_does_not_fall_back_on_other_404(self):
        opener = FakeOpener([
            _http_error(404, {"error": {"status": "NOT_FOUND",
                                        "message": "model not found"}}),
        ])
        client = G.GeminiClient(api_key="k", opener=opener, sleep=lambda s: None,
                                model_fallbacks=["gemini-3.8-flash"])
        with self.assertRaises(G.GeminiError):
            client.ask("q")
        self.assertEqual(len(opener.calls), 1)

    def test_exhausted_chain_raises_the_last_error(self):
        retired = _http_error(404, {"error": {"status": "NOT_FOUND",
                                              "message": "no longer available"}})
        opener = FakeOpener([retired, _http_error(
            404, {"error": {"status": "NOT_FOUND", "message": "no longer available"}})])
        client = G.GeminiClient(api_key="k", opener=opener, sleep=lambda s: None,
                                model_fallbacks=["gemini-3.8-flash"])
        with self.assertRaises(G.GeminiError) as ctx:
            client.ask("q")
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(len(opener.calls), 2)

    def test_grounding_429_still_raises_rate_limited(self):
        """A blocked grounding sweep stays inconclusive, never absent."""
        opener = FakeOpener([_http_error(429, {"error": {"status": "RESOURCE_EXHAUSTED"}})] * 3)
        client = G.GeminiClient(api_key="k", opener=opener, sleep=lambda s: None)
        with self.assertRaises(G.GeminiError) as ctx:
            client.ask("q")
        self.assertEqual(ctx.exception.error_type, "rate_limited")


def _rate_limited():
    return _http_error(429, {"error": {"status": "RESOURCE_EXHAUSTED",
                                       "message": "You exceeded your current quota"}})


class TestEngineClassification(unittest.TestCase):
    def test_gemma_slug_is_gemma(self):
        self.assertEqual(G._engine_of("gemma-4-26b-a4b-it"), "gemma")

    def test_gemini_slugs_are_gemini(self):
        for m in ("gemini-flash-latest", "gemini-3.8-flash", "gemini-2.5-flash"):
            self.assertEqual(G._engine_of(m), "gemini")

    def test_missing_model_defaults_to_gemini(self):
        self.assertEqual(G._engine_of(None), "gemini")


class TestGroundingFallback(unittest.TestCase):
    """When Gemini refuses grounding, a labelled Gemma answer stands in."""

    def _client(self, responses, **kw):
        return G.GeminiClient(api_key="k", opener=FakeOpener(responses),
                              sleep=lambda s: None, model_fallbacks=[],
                              max_retries=1, **kw)

    def test_gemini_success_does_not_fall_back(self):
        opener = FakeOpener([_body("gemini answer")])
        client = G.GeminiClient(api_key="k", opener=opener, sleep=lambda s: None,
                                model_fallbacks=[], max_retries=1)
        result = client.ask_with_fallback("q")
        self.assertEqual(result["engine"], "gemini")
        self.assertNotIn("fallback_from", result)
        self.assertEqual(len(opener.calls), 1)

    def test_refused_grounding_falls_back_to_gemma_labelled(self):
        opener = FakeOpener([_rate_limited(), _body("gemma answer")])
        client = G.GeminiClient(api_key="k", opener=opener, sleep=lambda s: None,
                                model_fallbacks=[], max_retries=1,
                                fallback_model="gemma-4-26b-a4b-it")
        result = client.ask_with_fallback("q")
        self.assertTrue(result["ok"])
        self.assertEqual(result["engine"], "gemma")
        self.assertEqual(result["model"], "gemma-4-26b-a4b-it")
        self.assertEqual(result["fallback_from"], G.DEFAULT_MODEL)
        self.assertIn("gemma-4-26b-a4b-it", opener.calls[1].full_url)

    def test_fallback_disabled_raises(self):
        client = self._client([_rate_limited()], allow_fallback=False)
        with self.assertRaises(G.GeminiError):
            client.ask_with_fallback("q")

    def test_explicit_model_disables_fallback_by_default(self):
        # A pinned model means "test that model"; substituting would be a lie.
        client = G.GeminiClient(api_key="k", model="gemini-flash-latest",
                                opener=FakeOpener([_rate_limited()]),
                                sleep=lambda s: None, max_retries=1)
        self.assertFalse(client._allow_fallback)
        with self.assertRaises(G.GeminiError):
            client.ask_with_fallback("q")

    def test_bad_request_does_not_fall_back(self):
        # A 400 is a real failure, not a quota refusal; no substitution.
        opener = FakeOpener([_http_error(400, {"error": {"status": "INVALID_ARGUMENT"}})])
        client = G.GeminiClient(api_key="k", opener=opener, sleep=lambda s: None,
                                model_fallbacks=[], max_retries=1,
                                fallback_model="gemma-4-26b-a4b-it")
        with self.assertRaises(G.GeminiError):
            client.ask_with_fallback("q")
        self.assertEqual(len(opener.calls), 1)

    def test_fallback_failure_is_raised_not_swallowed(self):
        opener = FakeOpener([_rate_limited(),
                             _http_error(503, {"error": {"status": "UNAVAILABLE"}})])
        client = G.GeminiClient(api_key="k", opener=opener, sleep=lambda s: None,
                                model_fallbacks=[], max_retries=1,
                                fallback_model="gemma-4-26b-a4b-it")
        with self.assertRaises(G.GeminiError):
            client.ask_with_fallback("q")

    def test_plain_ask_never_falls_back(self):
        opener = FakeOpener([_rate_limited()])
        client = G.GeminiClient(api_key="k", opener=opener, sleep=lambda s: None,
                                model_fallbacks=[], max_retries=1,
                                fallback_model="gemma-4-26b-a4b-it")
        with self.assertRaises(G.GeminiError):
            client.ask("q")
        self.assertEqual(len(opener.calls), 1)


class TestFallbackRecordLabel(unittest.TestCase):
    def test_gemma_record_carries_engine_and_fallback_from(self):
        result = {"ok": True, "answer": "call Straight Flush Plumbing",
                  "model": "gemma-4-26b-a4b-it", "engine": "gemma",
                  "fallback_from": "gemini-flash-latest", "sources": [], "citations": [],
                  "domains": [], "search_queries": ["q"], "usage": {}}
        rec = G.build_record("q", "Laguna Niguel", result)
        self.assertEqual(rec["engine"], "gemma")
        self.assertEqual(rec["fallback_from"], "gemini-flash-latest")
        self.assertIn("Gemma fallback", rec["note"])
        self.assertIn("not the Gemini/AI-Overviews surface", rec["note"])
        # still an AI-platform row — the answer engine ran
        self.assertEqual(rec["test_type"], "ai_platform")

    def test_gemini_record_has_no_fallback_marker(self):
        result = {"ok": True, "answer": "x", "model": "gemini-flash-latest",
                  "sources": [], "citations": [], "domains": [],
                  "search_queries": [], "usage": {}}
        rec = G.build_record("q", "c", result)
        self.assertEqual(rec["engine"], "gemini")
        self.assertIsNone(rec["fallback_from"])
        self.assertNotIn("Gemma fallback", rec["note"])


class CliRunExitTests(unittest.TestCase):
    """The CLI's exit code must say whether the sweep measured anything.

    A sweep in which every grounded query was refused by the platform (quota, 5xx,
    network) used to return 0, so the daily runner counted a blocked AI surface as
    a clean pass and the day recorded no AI visibility at all. The rows stay
    `inconclusive` (a failed test is not zero), but the exit code is now 3 for a
    platform block and 2 for other total failures. A labelled Gemma fallback
    answer is a real measurement, so it keeps exit 0.
    """

    def _run_cli(self, side_effect):
        import contextlib
        from unittest import mock
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.object(G, "GeminiClient") as client_cls, \
                mock.patch.dict(os.environ, {"GEMINI_API_KEY": "k"}):
            client_cls.return_value.ask_with_fallback.side_effect = side_effect
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                code = G.main(["--run", "--queries-file", self._qfile,
                               "--limit", "3"])
        return code, stdout.getvalue(), stderr.getvalue()

    def setUp(self):
        import tempfile
        self._tmp = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False)
        self._tmp.write("q1\nq2\nq3\n")
        self._tmp.close()
        self._qfile = self._tmp.name

    def tearDown(self):
        os.unlink(self._qfile)

    @staticmethod
    def _err(error_type, status_code):
        return G.GeminiError("boom", error_type=error_type, status_code=status_code)

    def test_all_rate_limited_is_blocked_exit_3(self):
        code, out, err = self._run_cli(self._err("rate_limited", 429))
        self.assertEqual(code, 3)
        self.assertIn("BLOCKED", err)
        self.assertIn('"succeeded": 0', out)

    def test_all_server_error_is_blocked_exit_3(self):
        code, _out, _err = self._run_cli(self._err("server_error", 500))
        self.assertEqual(code, 3)

    def test_mixed_error_types_still_blocked_exit_3(self):
        side = [self._err("rate_limited", 429), self._err("timeout", None),
                self._err("connection_error", None)]
        code, _out, _err = self._run_cli(side)
        self.assertEqual(code, 3)

    def test_all_auth_failed_is_failure_exit_2(self):
        """A bad key is a real failure to investigate, not a platform block."""
        code, _out, err = self._run_cli(self._err("authentication_failed", 403))
        self.assertEqual(code, 2)
        self.assertNotIn("BLOCKED", err)

    def test_one_success_keeps_exit_0(self):
        good = {"ok": True, "model": "m", "answer": "Straight Flush Plumbing",
                "sources": [], "citations": [], "domains": [],
                "search_queries": [], "usage": {}}
        side = [self._err("rate_limited", 429), good, self._err("rate_limited", 429)]
        code, out, _err = self._run_cli(side)
        self.assertEqual(code, 0)
        self.assertIn('"succeeded": 1', out)

    def test_empty_query_list_is_not_a_failure(self):
        """No queries measured nothing, but must not read as "every query failed"."""
        import tempfile
        empty = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False)
        empty.close()
        try:
            import contextlib
            from unittest import mock
            stdout, stderr = io.StringIO(), io.StringIO()
            with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "k"}):
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    code = G.main(["--run", "--queries-file", empty.name, "--limit", "3"])
        finally:
            os.unlink(empty.name)
        self.assertEqual(code, 0)
        self.assertNotIn("failed", stderr.getvalue())


class CliNoKeyTests(unittest.TestCase):
    def test_missing_key_exits_1_without_recording(self):
        import contextlib
        from unittest import mock
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, {}, clear=True):
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                code = G.main(["--run", "--queries-file", "/dev/null"])
        self.assertEqual(code, 1)
        self.assertIn("not zero visibility", stderr.getvalue())

    def test_dry_run_needs_no_key(self):
        import contextlib
        from unittest import mock
        stdout, stderr = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, {}, clear=True):
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                code = G.main(["--run", "--dry-run"])
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
