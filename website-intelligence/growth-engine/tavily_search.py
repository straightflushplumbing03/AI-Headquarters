#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tavily Search client — the reliable conventional-search proxy.

Replaces the fragile Brave / DuckDuckGo-HTML scraping in the daily run. Brave
rate-limits our egress IP with HTTP 429 after ~7-8 rapid queries and DuckDuckGo
HTML intermittently returns 202; both have cost the growth engine whole research
runs. Tavily returns ranked web results as structured JSON over a documented API.

HONESTY — this is CONVENTIONAL SEARCH, not an AI answer engine.
`POST https://api.tavily.com/search` returns ranked web pages. It is recorded with
`test_type: "conventional_proxy"`, exactly like the existing brave_search and
duckduckgo_html rows. It must never be reported as ChatGPT/Perplexity/Claude
output. (Tavily can synthesise an `answer`, but that is Tavily's own summarisation
of search results, not a consumer assistant's recommendation — so `include_answer`
defaults to off and the classification is driven by the ranked results.)

Stdlib only: no SDK, no new dependency. Auth is the documented
`Authorization: Bearer tvly-...` header.
"""
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ENDPOINT = "https://api.tavily.com/search"

ERROR_TYPES = (
    "authentication_failed",
    "rate_limited",
    "bad_request",
    "server_error",
    "connection_error",
    "timeout",
    "unknown_error",
)

DEFAULT_TIMEOUT_S = 30
MAX_RETRIES = 3
DEFAULT_MAX_RESULTS = 10

SF_DOMAIN = "straightflushplumbingoc.com"
SF_NAMES = ("straight flush plumbing", "straightflushplumbing")

# The platform stores secrets case-sensitively; OpenHands Cloud injects the
# Tavily secret into automation runs as `Tavily_api_key` (not the all-caps name
# the docs use). Accept either so a scheduled run does not silently record a
# false "key missing" and skip the sweep.
API_KEY_ENV_VARS = ("TAVILY_API_KEY", "Tavily_api_key")


class TavilyError(RuntimeError):
    """A failed Tavily call, carrying the repo's shared error taxonomy."""

    def __init__(self, message, error_type="unknown_error", status_code=None,
                 retry_after=None):
        super().__init__(message)
        self.error_type = error_type if error_type in ERROR_TYPES else "unknown_error"
        self.status_code = status_code
        self.retry_after = retry_after

    def as_dict(self):
        return {
            "ok": False,
            "error_type": self.error_type,
            "status_code": self.status_code,
            "message": str(self),
            "retry_after": self.retry_after,
        }


def _env_api_key():
    """The first accepted env var that is set and non-empty. Never the value."""
    for name in API_KEY_ENV_VARS:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return ""


def api_key_present():
    """True when an accepted env var holds a non-empty key. Never returns it."""
    return bool(_env_api_key())


def _require_key():
    if not api_key_present():
        raise TavilyError(
            "TAVILY_API_KEY is not set. Create a key at https://app.tavily.com and "
            "export it in your own shell:  export TAVILY_API_KEY=tvly-...  "
            "Do not commit it or paste it into a chat.",
            error_type="authentication_failed",
        )


def _require_client_key(api_key):
    """Validate the client's own resolved key (not the global env var).

    Checking the env var here would ignore a key passed explicitly to the
    constructor, and would also break when the env var is set later.
    """
    if not (api_key or "").strip():
        raise TavilyError(
            "No Tavily API key available. Set TAVILY_API_KEY in the environment, "
            "or pass api_key=... explicitly. Create one at https://app.tavily.com.",
            error_type="authentication_failed",
        )


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _classify_status(status):
    if status in (401, 403):
        return "authentication_failed"
    if status == 429:
        return "rate_limited"
    if status in (400, 404, 422):
        return "bad_request"
    if status and status >= 500:
        return "server_error"
    return "unknown_error"


def _extract_error_message(body, status):
    """Tavily errors are JSON, but a proxy/gateway may return HTML."""
    try:
        parsed = json.loads(body)
    except (ValueError, TypeError):
        return (body or "")[:200]
    if isinstance(parsed, dict):
        detail = parsed.get("detail") or parsed.get("error") or parsed.get("message")
        if isinstance(detail, list) and detail:
            first = detail[0]
            if isinstance(first, dict):
                return str(first.get("msg") or first)
            return str(first)
        if detail:
            return str(detail)
    return f"HTTP {status}"


def domain_of(url):
    m = re.match(r"https?://([^/]+)", url or "")
    return m.group(1).lower().lstrip("www.") if m else ""


class TavilyClient:
    """Minimal, retrying Tavily Search client over stdlib urllib."""

    def __init__(self, api_key=None, timeout=DEFAULT_TIMEOUT_S, max_retries=MAX_RETRIES,
                 opener=None, sleep=time.sleep):
        self._api_key = (api_key or _env_api_key()).strip()
        self.timeout = timeout
        self.max_retries = max_retries
        self._opener = opener or urllib.request.urlopen
        self._sleep = sleep

    def search(self, query, max_results=DEFAULT_MAX_RESULTS, search_depth="basic",
               topic=None, include_domains=None, exclude_domains=None, country=None,
               include_answer=False, include_raw_content=False):
        """Run one search. Returns a normalised dict, or raises TavilyError.

        `include_answer` defaults to False so the result is unambiguously
        conventional search data (see the module docstring).
        """
        _require_client_key(self._api_key)
        payload = {"query": query, "max_results": max_results,
                   "search_depth": search_depth,
                   "include_answer": include_answer,
                   "include_raw_content": include_raw_content}
        if topic:
            payload["topic"] = topic
        if include_domains:
            payload["include_domains"] = include_domains
        if exclude_domains:
            payload["exclude_domains"] = exclude_domains
        if country:
            payload["country"] = country

        data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            ENDPOINT, data=data, method="POST",
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self._api_key}"})

        attempt = 0
        while True:
            attempt += 1
            try:
                with self._opener(request, timeout=self.timeout) as resp:
                    raw = resp.read().decode("utf-8", "replace")
                break
            except urllib.error.HTTPError as exc:
                body = ""
                try:
                    body = exc.read().decode("utf-8", "replace")
                except Exception:  # noqa: BLE001
                    pass
                retry_after = None
                try:
                    hdr = exc.headers.get("retry-after") if exc.headers else None
                    retry_after = float(hdr) if hdr is not None else None
                except (TypeError, ValueError):
                    retry_after = None
                err = TavilyError(_extract_error_message(body, exc.code),
                                  error_type=_classify_status(exc.code),
                                  status_code=exc.code, retry_after=retry_after)
                if err.error_type in ("rate_limited", "server_error") \
                        and attempt < self.max_retries:
                    delay = err.retry_after if err.retry_after is not None else 2 ** attempt
                    self._sleep(min(delay, 60))
                    continue
                raise err from exc
            except urllib.error.URLError as exc:
                err = TavilyError(f"connection failed: {exc.reason}",
                                  error_type="connection_error")
                if attempt < self.max_retries:
                    self._sleep(2 ** attempt)
                    continue
                raise err from exc
            except TimeoutError as exc:
                err = TavilyError(f"timed out after {self.timeout}s", error_type="timeout")
                if attempt < self.max_retries:
                    self._sleep(2 ** attempt)
                    continue
                raise err from exc

        try:
            parsed = json.loads(raw)
        except ValueError as exc:
            raise TavilyError("Tavily returned a non-JSON body",
                              error_type="server_error") from exc

        results = parsed.get("results") or []
        urls = [r.get("url") for r in results if r.get("url")]
        return {
            "ok": True,
            "query": parsed.get("query", query),
            "answer": parsed.get("answer"),
            "results": [
                {"url": r.get("url"), "title": r.get("title"),
                 "content": r.get("content"), "score": r.get("score")}
                for r in results
            ],
            "urls": urls,
            "domains": [d for d in (domain_of(u) for u in urls) if d],
            "response_time": parsed.get("response_time"),
            "request_id": parsed.get("request_id"),
        }


def classify_visibility(result):
    """Classify SF's appearance in the ranked results.

    Conventional-search semantics: SF is `cited` when its own domain is one of
    the ranked results, otherwise `absent`. There is no `recommended` here — a
    ranked list does not recommend, and claiming otherwise would be the exact
    error the methodology forbids. Returns `inconclusive` when the call failed.
    """
    if not result.get("ok"):
        return "inconclusive"
    domains = result.get("domains") or []
    if any(SF_DOMAIN in d for d in domains):
        return "cited"
    return "absent"


def build_record(query, city, result, *, platform="tavily_search",
                 test_type="conventional_proxy", web_search="n/a", ts=None,
                 confidence="medium", note=None):
    """Build one ai_visibility_history.jsonl record (conventional-search row)."""
    ts = ts or _now_iso()
    if result.get("ok"):
        domains = result.get("domains") or []
        default_note = (
            "Tavily Search API (api.tavily.com/search) ranked web results — "
            "CONVENTIONAL SEARCH, NOT an AI-platform result. Replaces Brave/"
            "DuckDuckGo-HTML scraping, which rate-limited our egress IP "
            "(Brave HTTP 429 after ~7-8 queries). "
            f"{len(result.get('results') or [])} result(s) returned."
        )
        return {
            "ts": ts,
            "platform": platform,
            "test_type": test_type,
            "query": query,
            "city": city,
            "web_search": web_search,
            "straight_flush": classify_visibility(result),
            "top_results": domains,
            "confidence": confidence,
            "note": note or default_note,
            "request_id": result.get("request_id"),
            "response_time": result.get("response_time"),
        }

    err = result.get("error") or result
    etype = err.get("error_type") or "unknown_error"
    status = err.get("status_code")
    return {
        "ts": ts,
        "platform": platform,
        "test_type": "test_failure",
        "query": query,
        "city": city,
        "web_search": "unknown",
        "straight_flush": "inconclusive",
        "top_results": [],
        "confidence": "low",
        "note": (
            f"Tavily Search call failed ({etype}"
            f"{', HTTP ' + str(status) if status else ''}). Recorded inconclusive "
            "per methodology: a failed test is not zero visibility. "
            f"{err.get('message', '')}"
        ).strip(),
        "error_type": etype,
        "status_code": status,
    }


def append_records(path, records):
    """Append records to a .jsonl file, creating parent dirs. Returns the count."""
    if not records:
        return 0
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        for rec in records:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return len(records)
