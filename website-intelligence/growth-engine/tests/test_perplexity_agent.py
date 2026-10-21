#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for the Perplexity Agent API integration.

No network access and no API key required: every test uses fake response objects
and a fake sleep, so the suite is safe to run in CI and by the daily automation.

Run:  python3 -m unittest discover -s growth-engine/tests -v
"""
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "growth-engine"))

import ai_agent_client as AC  # noqa: E402


# ------------------------------------------------------------------ fakes
class FakeSearchResult:
    def __init__(self, url, title="T", snippet="S", date=None, source="web"):
        self.url, self.title, self.snippet = url, title, snippet
        self.date, self.source = date, source


class FakeSearchItem:
    type = "search_results"

    def __init__(self, results):
        self.results = results
        self.queries = ["plumber laguna niguel"]


class FakeAnnotation:
    def __init__(self, url, title="C"):
        self.url, self.title, self.type = url, title, "citation"


class FakeContentPart:
    type = "output_text"

    def __init__(self, text, annotations=None):
        self.text, self.annotations = text, annotations or []


class FakeMessageItem:
    type = "message"
    role = "assistant"
    status = "completed"
    id = "msg_1"

    def __init__(self, content):
        self.content = content


class FakeUsage:
    input_tokens = 120
    output_tokens = 340
    total_tokens = 460


class FakeResponse:
    def __init__(self, text, results=(), annotations=()):
        self.id = "resp_123"
        self.model = "openai/gpt-5.6-sol"
        self.status = "completed"
        self.object = "response"
        self.usage = FakeUsage()
        self.output = []
        if results:
            self.output.append(FakeSearchItem(list(results)))
        self.output.append(FakeMessageItem([FakeContentPart(text, list(annotations))]))
        self._text = text

    @property
    def output_text(self):
        return self._text


class FakeResponses:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class FakeClient:
    def __init__(self, script):
        self.responses = FakeResponses(script)


# ------------------------------------------------------------------ tests
class TestApiKeyHandling(unittest.TestCase):
    def setUp(self):
        self._saved = os.environ.pop("PERPLEXITY_API_KEY", None)

    def tearDown(self):
        os.environ.pop("PERPLEXITY_API_KEY", None)
        if self._saved is not None:
            os.environ["PERPLEXITY_API_KEY"] = self._saved

    def test_present_false_when_unset(self):
        self.assertFalse(AC.api_key_present())

    def test_present_false_when_blank(self):
        os.environ["PERPLEXITY_API_KEY"] = "   "
        self.assertFalse(AC.api_key_present())

    def test_present_true_when_set(self):
        os.environ["PERPLEXITY_API_KEY"] = "pplx-not-a-real-key"
        self.assertTrue(AC.api_key_present())

    def test_present_true_for_platform_cased_secret(self):
        # OpenHands Cloud injects the secret as `Perplexity_api_key`.
        os.environ["Perplexity_api_key"] = "pplx-not-a-real-key"
        try:
            self.assertTrue(AC.api_key_present())
        finally:
            os.environ.pop("Perplexity_api_key", None)

    def test_canonical_name_wins_when_both_set(self):
        os.environ["PERPLEXITY_API_KEY"] = "pplx-canonical"
        os.environ["Perplexity_api_key"] = "pplx-platform"
        try:
            self.assertEqual(AC._env_api_key(), "pplx-canonical")
        finally:
            os.environ.pop("Perplexity_api_key", None)

    def test_client_uses_platform_cased_secret(self):
        os.environ["Perplexity_api_key"] = "pplx-not-a-real-key"
        try:
            self.assertEqual(AC.AgentClient()._api_key, "pplx-not-a-real-key")
        finally:
            os.environ.pop("Perplexity_api_key", None)

    def test_missing_key_raises_authentication_failed(self):
        client = AC.AgentClient(api_key="")
        with self.assertRaises(AC.AgentError) as ctx:
            client.ask("plumber in Laguna Niguel")
        self.assertEqual(ctx.exception.error_type, "authentication_failed")

    def test_error_dict_never_contains_key(self):
        secret = "pplx-super-secret-value"
        os.environ["PERPLEXITY_API_KEY"] = secret
        err = AC.AgentError("boom", error_type="bad_request", status_code=400)
        blob = repr(err.as_dict()) + repr(err) + repr(err.error_type)
        self.assertNotIn(secret, blob)


class TestClassifyError(unittest.TestCase):
    def _exc(self, name, status=None, retry_after=None):
        cls = type(name, (Exception,), {})
        exc = cls("failed")
        exc.status_code = status
        if retry_after is not None:
            class H:
                def get(self, k):
                    return retry_after if k.lower() == "retry-after" else None
            class R:
                headers = H()
                status_code = status
            exc.response = R()
        return exc

    def test_auth(self):
        self.assertEqual(
            AC.classify_error(self._exc("AuthenticationError", 401)).error_type,
            "authentication_failed")

    def test_forbidden_is_auth(self):
        self.assertEqual(
            AC.classify_error(self._exc("PermissionDeniedError", 403)).error_type,
            "authentication_failed")

    def test_rate_limit_carries_retry_after(self):
        err = AC.classify_error(self._exc("RateLimitError", 429, retry_after="7"))
        self.assertEqual(err.error_type, "rate_limited")
        self.assertEqual(err.retry_after, 7.0)

    def test_bad_request_invalid_model_slug(self):
        self.assertEqual(
            AC.classify_error(self._exc("BadRequestError", 400)).error_type,
            "bad_request")

    def test_server_error(self):
        self.assertEqual(
            AC.classify_error(self._exc("InternalServerError", 503)).error_type,
            "server_error")

    def test_connection_and_timeout(self):
        self.assertEqual(
            AC.classify_error(self._exc("APIConnectionError")).error_type,
            "connection_error")
        self.assertEqual(
            AC.classify_error(self._exc("APITimeoutError")).error_type, "timeout")

    def test_unknown(self):
        self.assertEqual(AC.classify_error(ValueError("x")).error_type,
                         "unknown_error")

    def test_every_type_is_in_taxonomy(self):
        for name, status in (("AuthenticationError", 401), ("RateLimitError", 429),
                             ("BadRequestError", 400), ("InternalServerError", 500),
                             ("APITimeoutError", None), ("APIConnectionError", None)):
            e = AC.classify_error(self._exc(name, status))
            self.assertIn(e.error_type, AC.ERROR_TYPES)


class TestClassifyVisibility(unittest.TestCase):
    def test_absent_when_not_mentioned(self):
        self.assertEqual(
            AC.classify_visibility("Efficient Plumbing is great.", [], []),
            "absent")

    def test_cited_when_sf_url_in_sources(self):
        src = [{"url": "https://straightflushplumbingoc.com/slab-leak-detection.html"}]
        self.assertEqual(
            AC.classify_visibility("Several companies serve the area.", src, []),
            "cited")

    def test_cited_when_sf_url_in_citations(self):
        cites = [{"url": "https://straightflushplumbingoc.com/"}]
        self.assertEqual(
            AC.classify_visibility("Some answer text.", [], cites), "cited")

    def test_recommended_when_sentence_recommends_sf(self):
        text = ("For slab leaks, Straight Flush Plumbing & Leak Detection is the "
                "best choice in Laguna Niguel.")
        self.assertEqual(AC.classify_visibility(text, [], []), "recommended")

    def test_mentioned_without_recommendation(self):
        text = "Straight Flush Plumbing also operates in the area."
        self.assertEqual(AC.classify_visibility(text, [], []), "mentioned")

    def test_mention_of_other_business_named_similarly_is_absent(self):
        text = "Straight Flush Rooter of Ohio is unrelated."
        self.assertEqual(AC.classify_visibility(text, [], []), "absent")

    def test_empty_answer_is_inconclusive(self):
        self.assertEqual(AC.classify_visibility("", [], []), "inconclusive")
        self.assertEqual(AC.classify_visibility(None, [], []), "inconclusive")

    def test_never_returns_incorrect(self):
        for text in ("", "Straight Flush is best", "nothing here"):
            self.assertNotEqual(AC.classify_visibility(text, [], []), "incorrect")

    def test_sf_name_in_text_alone_is_not_a_citation(self):
        text = "Straight Flush Plumbing & Leak Detection is recommended."
        self.assertEqual(AC.classify_visibility(text, [], []), "recommended")


class TestExtraction(unittest.TestCase):
    def test_extracts_sources_citations_domains_usage(self):
        resp = FakeResponse(
            "Straight Flush Plumbing & Leak Detection is the best option.",
            results=[FakeSearchResult("https://straightflushplumbingoc.com/a.html"),
                     FakeSearchResult("https://www.yelp.com/biz/x")],
            annotations=[FakeAnnotation("https://straightflushplumbingoc.com/a.html")])
        src = AC._extract_sources(resp)
        cit = AC._extract_citations(resp)
        self.assertEqual(len(src), 2)
        self.assertEqual(len(cit), 1)
        self.assertEqual(AC._domains(src, cit),
                         ["straightflushplumbingoc.com", "yelp.com"])
        self.assertEqual(AC._extract_usage(resp.usage),
                         {"input_tokens": 120, "output_tokens": 340,
                          "total_tokens": 460})

    def test_dedupes_sources(self):
        resp = FakeResponse("x", results=[FakeSearchResult("https://a.com/1"),
                                          FakeSearchResult("https://a.com/1")])
        self.assertEqual(len(AC._extract_sources(resp)), 1)

    def test_usage_none_is_zeroed(self):
        self.assertEqual(AC._extract_usage(None),
                         {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0})

    def test_no_search_results_is_empty_not_error(self):
        resp = FakeResponse("Answer with no sources.")
        self.assertEqual(AC._extract_sources(resp), [])
        self.assertEqual(AC._extract_citations(resp), [])


class TestAgentClientRequests(unittest.TestCase):
    def _client(self, script, **kw):
        c = AC.AgentClient(api_key="k", **kw)
        c._client = FakeClient(script)
        c._sleep = lambda _s: None
        return c

    def test_preset_mode_sends_preset_not_model(self):
        c = self._client([FakeResponse("ok")], preset="low")
        c.ask("q")
        kwargs = c._client.responses.calls[0]
        self.assertEqual(kwargs["preset"], "low")
        self.assertNotIn("model", kwargs)
        self.assertEqual(kwargs["input"], "q")

    def test_model_mode_sends_model_and_web_search_tool(self):
        c = self._client([FakeResponse("ok")], model="openai/gpt-5.6-sol")
        c.ask("q")
        kwargs = c._client.responses.calls[0]
        self.assertEqual(kwargs["model"], "openai/gpt-5.6-sol")
        self.assertNotIn("preset", kwargs)
        self.assertEqual(kwargs["tools"], [{"type": "web_search"}])

    def test_optional_params_forwarded(self):
        c = self._client([FakeResponse("ok")], preset="low")
        c.ask("q", instructions="be brief", max_output_tokens=100, max_steps=2,
              previous_response_id="resp_0")
        kwargs = c._client.responses.calls[0]
        self.assertEqual(kwargs["instructions"], "be brief")
        self.assertEqual(kwargs["max_output_tokens"], 100)
        self.assertEqual(kwargs["max_steps"], 2)
        self.assertEqual(kwargs["previous_response_id"], "resp_0")

    def test_response_format_forwarded(self):
        fmt = {"type": "json_schema",
               "json_schema": {"name": "s", "schema": {"type": "object"}}}
        c = self._client([FakeResponse("{}")], preset="low")
        c.ask("q", response_format=fmt)
        self.assertEqual(c._client.responses.calls[0]["response_format"], fmt)

    def test_normalised_result_shape(self):
        c = self._client([FakeResponse("hello", results=[
            FakeSearchResult("https://x.com/1")])], preset="low")
        r = c.ask("q")
        self.assertTrue(r["ok"])
        self.assertEqual(r["response_id"], "resp_123")
        self.assertEqual(r["answer"], "hello")
        self.assertEqual(r["domains"], ["x.com"])
        self.assertEqual(r["usage"]["input_tokens"], 120)

    def test_retries_rate_limit_then_succeeds(self):
        err = AC.classify_error  # noqa: F841  (documentation of intent)
        rl = type("RateLimitError", (Exception,), {"status_code": 429})("slow down")
        c = self._client([rl, FakeResponse("recovered")], preset="low", max_retries=3)
        r = c.ask("q")
        self.assertTrue(r["ok"])
        self.assertEqual(len(c._client.responses.calls), 2)

    def test_honours_retry_after_value(self):
        class H:
            def get(self, k):
                return "9" if k.lower() == "retry-after" else None

        class R:
            headers = H()
            status_code = 429

        rl = type("RateLimitError", (Exception,), {"status_code": 429})("overloaded")
        rl.response = R()
        slept = []
        c = self._client([rl, FakeResponse("ok")], preset="low", max_retries=3)
        c._sleep = slept.append
        c.ask("q")
        self.assertEqual(slept, [9.0])

    def test_gives_up_after_max_retries(self):
        rl = type("RateLimitError", (Exception,), {"status_code": 429})("overloaded")
        c = self._client([rl, rl, rl], preset="low", max_retries=3)
        with self.assertRaises(AC.AgentError) as ctx:
            c.ask("q")
        self.assertEqual(ctx.exception.error_type, "rate_limited")
        self.assertEqual(len(c._client.responses.calls), 3)

    def test_does_not_retry_bad_request(self):
        br = type("BadRequestError", (Exception,), {"status_code": 400})("bad model")
        c = self._client([br], preset="low", max_retries=3)
        with self.assertRaises(AC.AgentError) as ctx:
            c.ask("q")
        self.assertEqual(ctx.exception.error_type, "bad_request")
        self.assertEqual(len(c._client.responses.calls), 1)

    def test_does_not_retry_auth_error(self):
        ae = type("AuthenticationError", (Exception,), {"status_code": 401})("no")
        c = self._client([ae], preset="low", max_retries=3)
        with self.assertRaises(AC.AgentError):
            c.ask("q")
        self.assertEqual(len(c._client.responses.calls), 1)


class TestBuildRecord(unittest.TestCase):
    def _ok(self, text="Straight Flush Plumbing is the best choice."):
        return {"ok": True, "answer": text, "model": "openai/gpt-5.6-sol",
                "response_id": "resp_1", "status": "completed",
                "sources": [{"url": "https://straightflushplumbingoc.com/a.html"}],
                "citations": [], "domains": ["straightflushplumbingoc.com"],
                "usage": {"input_tokens": 1, "output_tokens": 2, "total_tokens": 3}}

    def test_success_record_matches_existing_jsonl_schema(self):
        rec = AC.build_record("q", "Laguna Niguel", self._ok(), ts="2026-10-15T00:00:00Z")
        for key in ("ts", "platform", "test_type", "query", "city", "web_search",
                    "straight_flush", "top_results", "confidence", "note"):
            self.assertIn(key, rec)
        self.assertEqual(rec["straight_flush"], "cited")
        self.assertEqual(rec["test_type"], "ai_platform")
        self.assertEqual(rec["web_search"], "yes")
        self.assertEqual(rec["ts"], "2026-10-15T00:00:00Z")

    def test_success_record_does_not_store_full_answer(self):
        rec = AC.build_record("q", "c", self._ok("secret answer text"))
        self.assertNotIn("answer", rec)
        self.assertEqual(len(rec["answer_sha256"]), 64)
        self.assertEqual(rec["answer_chars"], len("secret answer text"))

    def test_failure_record_is_inconclusive_not_absent(self):
        err = {"ok": False, "error_type": "rate_limited", "status_code": 429,
               "message": "overloaded"}
        rec = AC.build_record("q", "c", err)
        self.assertEqual(rec["straight_flush"], "inconclusive")
        self.assertEqual(rec["test_type"], "test_failure")
        self.assertNotEqual(rec["straight_flush"], "absent")
        self.assertEqual(rec["error_type"], "rate_limited")

    def test_failure_record_explains_why(self):
        rec = AC.build_record("q", "c", {"ok": False, "error_type": "connection_error",
                                         "message": "no route"})
        self.assertIn("inconclusive", rec["note"].lower())
        self.assertIn("connection_error", rec["note"])

    def test_provider_error_string_is_normalised(self):
        # Real Perplexity error body: {"type": "invalid_api_key", "code": 401}
        rec = AC.build_record("q", "c", {"ok": False, "error": {
            "message": "Invalid API key provided.", "type": "invalid_api_key",
            "code": 401}})
        self.assertEqual(rec["error_type"], "authentication_failed")
        self.assertEqual(rec["status_code"], 401)
        self.assertIn("authentication_failed", rec["note"])
        self.assertIn("Invalid API key provided.", rec["note"])

    def test_overloaded_error_maps_to_rate_limited(self):
        rec = AC.build_record("q", "c", {"ok": False, "error": {
            "type": "overloaded_error", "message": "model overloaded"}})
        self.assertEqual(rec["error_type"], "rate_limited")

    def test_unknown_provider_string_falls_back(self):
        rec = AC.build_record("q", "c", {"ok": False, "error": {
            "type": "something_new", "message": "?"}})
        self.assertEqual(rec["error_type"], "unknown_error")

    def test_timestamp_defaults_when_not_given(self):
        rec = AC.build_record("q", "c", self._ok())
        self.assertRegex(rec["ts"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_all_error_types_stay_in_taxonomy(self):
        for provider_type in ("invalid_api_key", "overloaded_error",
                              "invalid_request_error", "internal_server_error",
                              "brand_new_type", None):
            rec = AC.build_record("q", "c", {"ok": False, "error": {
                "type": provider_type, "message": "x"}})
            self.assertIn(rec["error_type"], AC.ERROR_TYPES)

    def test_record_never_contains_key(self):
        secret = "pplx-secret-abc123"
        rec = AC.build_record("q", "c", self._ok(f"answer mentioning {secret}"))
        self.assertNotIn(secret, repr(rec))


class TestAppendRecords(unittest.TestCase):
    def test_appends_jsonl_lines(self):
        import json
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "sub", "h.jsonl")
            n = AC.append_records(path, [{"a": 1}, {"b": 2}])
            self.assertEqual(n, 2)
            with open(path, encoding="utf-8") as fh:
                lines = [json.loads(ln) for ln in fh if ln.strip()]
            self.assertEqual(lines, [{"a": 1}, {"b": 2}])

    def test_empty_list_writes_nothing(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "h.jsonl")
            self.assertEqual(AC.append_records(path, []), 0)
            self.assertFalse(os.path.exists(path))


class TestCliDryRun(unittest.TestCase):
    def test_dry_run_makes_no_network_call_and_needs_no_key(self):
        import subprocess
        env = {k: v for k, v in os.environ.items() if k != "PERPLEXITY_API_KEY"}
        out = subprocess.run(
            [sys.executable, os.path.join(ROOT, "scripts", "perplexity_agent.py"),
             "--run", "--dry-run", "--limit", "2"],
            capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        import json
        payload = json.loads(out.stdout)
        self.assertTrue(payload["dry_run"])
        self.assertEqual(len(payload["queries"]), 2)

    def test_smoke_without_key_exits_nonzero_with_guidance(self):
        import subprocess
        env = {k: v for k, v in os.environ.items() if k != "PERPLEXITY_API_KEY"}
        out = subprocess.run(
            [sys.executable, os.path.join(ROOT, "scripts", "perplexity_agent.py"),
             "--smoke"],
            capture_output=True, text=True, env=env, timeout=60)
        self.assertEqual(out.returncode, 1)
        self.assertIn("PERPLEXITY_API_KEY", out.stderr)
        self.assertIn("console.perplexity.ai", out.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
