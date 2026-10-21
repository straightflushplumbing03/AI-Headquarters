#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for the Tavily Search integration.

No network access and no API key required: HTTP is stubbed with fake openers.

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

import tavily_search as TS  # noqa: E402


# ------------------------------------------------------------------ fakes
class FakeResponse:
    def __init__(self, payload, status=200):
        self._body = json.dumps(payload).encode("utf-8") if not isinstance(
            payload, bytes) else payload
        self.status = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def make_http_error(code, body, retry_after=None):
    headers = {}
    if retry_after is not None:
        headers["retry-after"] = str(retry_after)
    return urllib.error.HTTPError(
        url=TS.ENDPOINT, code=code, msg="err", hdrs=headers, fp=io.BytesIO(
            body.encode("utf-8")))


class FakeOpener:
    """Returns queued items in order; an Exception instance is raised."""

    def __init__(self, script):
        self.script = list(script)
        self.requests = []

    def __call__(self, request, timeout=None):
        self.requests.append({"request": request, "timeout": timeout})
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


PAYLOAD = {
    "query": "plumber in Laguna Niguel",
    "answer": None,
    "results": [
        {"url": "https://www.rotorooter.com/oc/", "title": "Rooter", "content": "c",
         "score": 0.9},
        {"url": "https://efficientplumbing.com/", "title": "Efficient", "content": "c",
         "score": 0.8},
        {"url": "https://straightflushplumbingoc.com/", "title": "Straight Flush",
         "content": "c", "score": 0.7},
    ],
    "response_time": 1.23,
    "request_id": "req_abc",
}


# ------------------------------------------------------------------ tests
class TestApiKeyHandling(unittest.TestCase):
    def setUp(self):
        self._saved = os.environ.pop("TAVILY_API_KEY", None)

    def tearDown(self):
        os.environ.pop("TAVILY_API_KEY", None)
        if self._saved is not None:
            os.environ["TAVILY_API_KEY"] = self._saved

    def test_present_false_when_unset(self):
        self.assertFalse(TS.api_key_present())

    def test_present_false_when_blank(self):
        os.environ["TAVILY_API_KEY"] = "  "
        self.assertFalse(TS.api_key_present())

    def test_present_true_when_set(self):
        os.environ["TAVILY_API_KEY"] = "tvly-dev-fake"
        self.assertTrue(TS.api_key_present())

    def test_present_true_for_platform_cased_secret(self):
        # OpenHands Cloud injects the secret as `Tavily_api_key`.
        os.environ["Tavily_api_key"] = "tvly-dev-fake"
        try:
            self.assertTrue(TS.api_key_present())
        finally:
            os.environ.pop("Tavily_api_key", None)

    def test_canonical_name_wins_when_both_set(self):
        os.environ["TAVILY_API_KEY"] = "tvly-canonical"
        os.environ["Tavily_api_key"] = "tvly-platform"
        try:
            self.assertEqual(TS._env_api_key(), "tvly-canonical")
        finally:
            os.environ.pop("Tavily_api_key", None)

    def test_client_uses_platform_cased_secret(self):
        os.environ["Tavily_api_key"] = "tvly-dev-fake"
        try:
            self.assertEqual(TS.TavilyClient()._api_key, "tvly-dev-fake")
        finally:
            os.environ.pop("Tavily_api_key", None)

    def test_missing_key_raises_authentication_failed(self):
        client = TS.TavilyClient(api_key="")
        with self.assertRaises(TS.TavilyError) as ctx:
            client.search("q")
        self.assertEqual(ctx.exception.error_type, "authentication_failed")

    def test_error_dict_never_contains_key(self):
        secret = "tvly-dev-super-secret"
        os.environ["TAVILY_API_KEY"] = secret
        err = TS.TavilyError("boom", error_type="bad_request", status_code=400)
        self.assertNotIn(secret, repr(err.as_dict()) + repr(err))


class TestRequestShape(unittest.TestCase):
    def _client(self, script, **kw):
        opener = FakeOpener(script)
        c = TS.TavilyClient(api_key="tvly-fake", opener=opener, **kw)
        c._sleep = lambda _s: None
        return c, opener

    def test_posts_bearer_auth_and_json_body(self):
        c, opener = self._client([FakeResponse(PAYLOAD)])
        c.search("plumber in Laguna Niguel")
        req = opener.requests[0]["request"]
        self.assertEqual(req.method, "POST")
        self.assertEqual(req.full_url, TS.ENDPOINT)
        self.assertEqual(req.get_header("Authorization"), "Bearer tvly-fake")
        self.assertEqual(req.get_header("Content-type"), "application/json")

    def test_body_carries_documented_params(self):
        c, opener = self._client([FakeResponse(PAYLOAD)])
        c.search("q", max_results=7, search_depth="advanced")
        body = json.loads(opener.requests[0]["request"].data.decode("utf-8"))
        self.assertEqual(body["query"], "q")
        self.assertEqual(body["max_results"], 7)
        self.assertEqual(body["search_depth"], "advanced")

    def test_include_answer_defaults_off(self):
        # Conventional search must not smuggle in a synthesised answer.
        c, opener = self._client([FakeResponse(PAYLOAD)])
        c.search("q")
        body = json.loads(opener.requests[0]["request"].data.decode("utf-8"))
        self.assertFalse(body["include_answer"])

    def test_optional_filters_only_sent_when_set(self):
        c, opener = self._client([FakeResponse(PAYLOAD)])
        c.search("q")
        body = json.loads(opener.requests[0]["request"].data.decode("utf-8"))
        for k in ("topic", "include_domains", "exclude_domains", "country"):
            self.assertNotIn(k, body)

        c2, opener2 = self._client([FakeResponse(PAYLOAD)])
        c2.search("q", topic="general", include_domains=["a.com"], country="united states")
        body2 = json.loads(opener2.requests[0]["request"].data.decode("utf-8"))
        self.assertEqual(body2["topic"], "general")
        self.assertEqual(body2["include_domains"], ["a.com"])
        self.assertEqual(body2["country"], "united states")

    def test_timeout_forwarded(self):
        c, opener = self._client([FakeResponse(PAYLOAD)], timeout=12)
        c.search("q")
        self.assertEqual(opener.requests[0]["timeout"], 12)


class TestResponseParsing(unittest.TestCase):
    def _search(self, payload):
        opener = FakeOpener([FakeResponse(payload)])
        c = TS.TavilyClient(api_key="k", opener=opener)
        c._sleep = lambda _s: None
        return c.search("q")

    def test_normalises_results_domains_and_metadata(self):
        r = self._search(PAYLOAD)
        self.assertTrue(r["ok"])
        self.assertEqual(len(r["results"]), 3)
        self.assertEqual(r["domains"],
                         ["rotorooter.com", "efficientplumbing.com",
                          "straightflushplumbingoc.com"])
        self.assertEqual(r["request_id"], "req_abc")
        self.assertEqual(r["response_time"], 1.23)

    def test_empty_results_is_ok_not_error(self):
        r = self._search({"results": []})
        self.assertTrue(r["ok"])
        self.assertEqual(r["domains"], [])

    def test_missing_results_key(self):
        r = self._search({})
        self.assertTrue(r["ok"])
        self.assertEqual(r["results"], [])

    def test_domain_strips_www(self):
        self.assertEqual(TS.domain_of("https://www.example.com/a"), "example.com")
        self.assertEqual(TS.domain_of("https://example.com"), "example.com")
        self.assertEqual(TS.domain_of("not-a-url"), "")

    def test_non_json_body_raises(self):
        opener = FakeOpener([FakeResponse(b"<html>gateway</html>")])
        c = TS.TavilyClient(api_key="k", opener=opener)
        c._sleep = lambda _s: None
        with self.assertRaises(TS.TavilyError) as ctx:
            c.search("q")
        self.assertEqual(ctx.exception.error_type, "server_error")


class TestClassifyVisibility(unittest.TestCase):
    def test_cited_when_own_domain_ranked(self):
        r = {"ok": True, "domains": ["yelp.com", "straightflushplumbingoc.com"]}
        self.assertEqual(TS.classify_visibility(r), "cited")

    def test_absent_when_not_ranked(self):
        r = {"ok": True, "domains": ["yelp.com", "rotorooter.com"]}
        self.assertEqual(TS.classify_visibility(r), "absent")

    def test_inconclusive_when_call_failed(self):
        self.assertEqual(TS.classify_visibility({"ok": False}), "inconclusive")

    def test_never_returns_recommended(self):
        # A ranked list does not recommend. Claiming otherwise is the exact
        # error the methodology forbids.
        for domains in ([], ["straightflushplumbingoc.com"], ["yelp.com"]):
            self.assertNotEqual(
                TS.classify_visibility({"ok": True, "domains": domains}),
                "recommended")


class TestErrorHandling(unittest.TestCase):
    def _client(self, script, **kw):
        opener = FakeOpener(script)
        c = TS.TavilyClient(api_key="k", opener=opener, **kw)
        c._sleep = lambda _s: None
        return c, opener

    def test_401_is_auth_and_not_retried(self):
        c, opener = self._client([make_http_error(401, '{"detail":"unauthorized"}')])
        with self.assertRaises(TS.TavilyError) as ctx:
            c.search("q")
        self.assertEqual(ctx.exception.error_type, "authentication_failed")
        self.assertEqual(len(opener.requests), 1)

    def test_400_is_bad_request(self):
        c, _ = self._client([make_http_error(400, '{"detail":"bad param"}')])
        with self.assertRaises(TS.TavilyError) as ctx:
            c.search("q")
        self.assertEqual(ctx.exception.error_type, "bad_request")

    def test_422_validation_error_is_readable(self):
        body = json.dumps({"detail": [{"msg": "field required"}]})
        c, _ = self._client([make_http_error(422, body)])
        with self.assertRaises(TS.TavilyError) as ctx:
            c.search("q")
        self.assertEqual(ctx.exception.error_type, "bad_request")
        self.assertIn("field required", str(ctx.exception))

    def test_429_retries_then_succeeds(self):
        c, opener = self._client(
            [make_http_error(429, "{}", retry_after=3), FakeResponse(PAYLOAD)],
            max_retries=3)
        r = c.search("q")
        self.assertTrue(r["ok"])
        self.assertEqual(len(opener.requests), 2)

    def test_429_honours_retry_after(self):
        slept = []
        c, _ = self._client([make_http_error(429, "{}", retry_after=7),
                             FakeResponse(PAYLOAD)], max_retries=3)
        c._sleep = slept.append
        c.search("q")
        self.assertEqual(slept, [7.0])

    def test_429_gives_up_after_max_retries(self):
        errs = [make_http_error(429, "{}") for _ in range(3)]
        c, opener = self._client(errs, max_retries=3)
        with self.assertRaises(TS.TavilyError) as ctx:
            c.search("q")
        self.assertEqual(ctx.exception.error_type, "rate_limited")
        self.assertEqual(len(opener.requests), 3)

    def test_500_is_server_error_and_retried(self):
        c, opener = self._client([make_http_error(500, "{}"), FakeResponse(PAYLOAD)],
                                 max_retries=3)
        self.assertTrue(c.search("q")["ok"])
        self.assertEqual(len(opener.requests), 2)

    def test_connection_error_retried(self):
        c, opener = self._client(
            [urllib.error.URLError("dns"), FakeResponse(PAYLOAD)], max_retries=3)
        self.assertTrue(c.search("q")["ok"])
        self.assertEqual(len(opener.requests), 2)

    def test_connection_error_gives_up(self):
        errs = [urllib.error.URLError("dns") for _ in range(3)]
        c, _ = self._client(errs, max_retries=3)
        with self.assertRaises(TS.TavilyError) as ctx:
            c.search("q")
        self.assertEqual(ctx.exception.error_type, "connection_error")

    def test_html_error_body_does_not_crash(self):
        # 502 is retryable, so supply one item per attempt.
        errs = [make_http_error(502, "<html>bad gateway</html>")
                for _ in range(TS.MAX_RETRIES)]
        c, _ = self._client(errs)
        with self.assertRaises(TS.TavilyError) as ctx:
            c.search("q")
        self.assertEqual(ctx.exception.error_type, "server_error")

    def test_every_error_type_is_in_taxonomy(self):
        for code in (400, 401, 403, 404, 422, 429, 500, 502):
            # Retryable codes (429, 5xx) consume one script item per attempt.
            errs = [make_http_error(code, "{}") for _ in range(TS.MAX_RETRIES)]
            c, _ = self._client(errs)
            with self.assertRaises(TS.TavilyError) as ctx:
                c.search("q")
            self.assertIn(ctx.exception.error_type, TS.ERROR_TYPES)


class TestBuildRecord(unittest.TestCase):
    def _ok(self):
        return {"ok": True, "results": PAYLOAD["results"],
                "domains": ["rotorooter.com", "straightflushplumbingoc.com"],
                "request_id": "req_abc", "response_time": 1.2}

    def test_record_is_conventional_proxy_not_ai_platform(self):
        rec = TS.build_record("q", "Laguna Niguel", self._ok())
        self.assertEqual(rec["test_type"], "conventional_proxy")
        self.assertEqual(rec["web_search"], "n/a")
        self.assertEqual(rec["platform"], "tavily_search")

    def test_record_matches_existing_jsonl_schema(self):
        rec = TS.build_record("q", "c", self._ok(), ts="2026-10-15T00:00:00Z")
        for key in ("ts", "platform", "test_type", "query", "city", "web_search",
                    "straight_flush", "top_results", "confidence", "note"):
            self.assertIn(key, rec)
        self.assertEqual(rec["ts"], "2026-10-15T00:00:00Z")
        self.assertEqual(rec["straight_flush"], "cited")

    def test_note_states_it_is_not_an_ai_platform(self):
        rec = TS.build_record("q", "c", self._ok())
        self.assertIn("NOT an AI-platform result", rec["note"])

    def test_failure_record_is_inconclusive_not_absent(self):
        rec = TS.build_record("q", "c", {"ok": False, "error_type": "rate_limited",
                                         "status_code": 429, "message": "slow"})
        self.assertEqual(rec["straight_flush"], "inconclusive")
        self.assertEqual(rec["test_type"], "test_failure")
        self.assertNotEqual(rec["straight_flush"], "absent")
        self.assertEqual(rec["error_type"], "rate_limited")

    def test_timestamp_defaults(self):
        rec = TS.build_record("q", "c", self._ok())
        self.assertRegex(rec["ts"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_record_never_contains_key(self):
        secret = "tvly-dev-abc123"
        rec = TS.build_record("q", "c", self._ok())
        self.assertNotIn(secret, repr(rec))


class TestAppendRecords(unittest.TestCase):
    def test_appends_jsonl_lines(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "sub", "h.jsonl")
            self.assertEqual(TS.append_records(path, [{"a": 1}, {"b": 2}]), 2)
            with open(path, encoding="utf-8") as fh:
                self.assertEqual([json.loads(ln) for ln in fh if ln.strip()],
                                 [{"a": 1}, {"b": 2}])

    def test_empty_writes_nothing(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "h.jsonl")
            self.assertEqual(TS.append_records(path, []), 0)
            self.assertFalse(os.path.exists(path))


class TestCli(unittest.TestCase):
    def _run(self, *args, **kw):
        import subprocess
        env = {k: v for k, v in os.environ.items() if k != "TAVILY_API_KEY"}
        env.update(kw.get("env", {}))
        return subprocess.run(
            [sys.executable, os.path.join(ROOT, "scripts", "tavily_search.py"), *args],
            capture_output=True, text=True, env=env, timeout=60)

    def test_dry_run_needs_no_key_and_no_network(self):
        out = self._run("--run", "--dry-run", "--limit", "2")
        self.assertEqual(out.returncode, 0, out.stderr)
        payload = json.loads(out.stdout)
        self.assertTrue(payload["dry_run"])
        self.assertEqual(payload["test_type"], "conventional_proxy")
        self.assertEqual(len(payload["queries"]), 2)

    def test_smoke_without_key_exits_with_guidance(self):
        out = self._run("--smoke")
        self.assertEqual(out.returncode, 1)
        self.assertIn("TAVILY_API_KEY", out.stderr)
        self.assertIn("app.tavily.com", out.stderr)

    def test_run_without_key_aborts_without_writing(self):
        out = self._run("--run")
        self.assertEqual(out.returncode, 1)
        self.assertIn("not zero visibility", out.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
