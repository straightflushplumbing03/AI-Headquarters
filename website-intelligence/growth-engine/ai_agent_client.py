#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Perplexity Agent API client for web-grounded AI-visibility measurement.

Wraps `POST /v1/agent` (the official Perplexity Python SDK, `from perplexity
import Perplexity`) so the growth engine can ask a real, web-grounded answer
engine a customer-style question and record the answer, its citations, and its
source list as evidence.

Why the Agent API: the visibility methodology needs *sources*, not just text.
Web grounding is a tool (`{"type": "web_search"}`), and `search_results` output
items carry the source metadata that becomes the `top_results` evidence.

Honesty rules enforced here (see growth-engine/AI_VISIBILITY_METHODOLOGY.md):
  * A failed call is recorded `inconclusive` — never converted to "absent" or 0%.
  * The classification returns at most mentioned / cited / recommended / absent /
    inconclusive. `incorrect` requires human judgement and is never set here.
  * The API key is read from PERPLEXITY_API_KEY and never printed, logged, or
    returned in any result dictionary.

No network access happens at import time.
"""
import hashlib
import json
import os
import re
import time

# Error taxonomy shared with the repo's TS provider layer
# (lib/ai/providers.ts `classifyError`): authentication_failed / rate_limited /
# bad_request / unknown_error.
ERROR_TYPES = (
    "authentication_failed",
    "rate_limited",
    "bad_request",
    "server_error",
    "connection_error",
    "timeout",
    "unknown_error",
)

# OpenHands Cloud stores secrets case-sensitively and injects this one as
# `Perplexity_api_key`; accept the documented all-caps name too.
API_KEY_ENV_VARS = ("PERPLEXITY_API_KEY", "Perplexity_api_key")

DEFAULT_PRESET = "low"
DEFAULT_MODEL = "openai/gpt-5.6-sol"
DEFAULT_TIMEOUT_S = 120
MAX_RETRIES = 3

# Hosts/strings that count as a Straight Flush appearance.
#
# The bare phrase "straight flush" is deliberately NOT matched: it is a poker
# hand, and unrelated businesses use it ("Straight Flush Rooter of Ohio"). Only
# the distinctive full business name counts, so we do not credit or penalise SF
# for a namesake.
SF_DOMAIN = "straightflushplumbingoc.com"
SF_NAMES = (
    "straight flush plumbing",      # covers "... Plumbing & Leak Detection"
    "straightflushplumbing",        # covers the URL slug / no-space spelling
)

# Recommendation phrasing, checked in the sentence around an SF mention.
_RECOMMEND_RE = re.compile(
    r"\b(recommend(?:ed|ation)?|best|top|excellent|trusted|reliable|"
    r"i would (?:choose|call)|go with|leading)\b",
    re.I,
)

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")


class AgentError(RuntimeError):
    """A failed Agent API call, carrying the repo's error taxonomy."""

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
        raise AgentError(
            "PERPLEXITY_API_KEY is not set. Create a key in the API Console "
            "(https://console.perplexity.ai) and export it in your own shell: "
            "export PERPLEXITY_API_KEY=...  Do not commit it.",
            error_type="authentication_failed",
            status_code=None,
        )


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# Provider error strings (e.g. Perplexity's own "invalid_api_key") mapped onto
# the repo's taxonomy so ai_visibility_history.jsonl has one consistent
# vocabulary, matching lib/ai/providers.ts in AI-Headquarters.
_PROVIDER_ERROR_MAP = {
    "invalid_api_key": "authentication_failed",
    "authentication_error": "authentication_failed",
    "unauthorized": "authentication_failed",
    "permission_denied": "authentication_failed",
    "rate_limit_exceeded": "rate_limited",
    "overloaded_error": "rate_limited",
    "invalid_request_error": "bad_request",
    "invalid_model": "bad_request",
    "not_found": "bad_request",
    "internal_server_error": "server_error",
    "api_error": "server_error",
}


def _normalize_error_type(err):
    """Map a provider error string onto ERROR_TYPES, defaulting to unknown_error."""
    raw = err.get("error_type") or err.get("type")
    if not raw:
        return "unknown_error"
    raw = str(raw)
    if raw in ERROR_TYPES:
        return raw
    return _PROVIDER_ERROR_MAP.get(raw.lower(), "unknown_error")


def classify_error(exc):
    """Map an SDK exception onto the repo's error taxonomy.

    Mirrors lib/ai/providers.ts: 401/403 -> authentication_failed. Adds the
    Agent API specifics: 429 -> rate_limited (carry Retry-After), 400 ->
    bad_request (an invalid model slug or unsupported parameter lands here).
    """
    name = type(exc).__name__
    status = getattr(exc, "status_code", None)
    if status is None:
        resp = getattr(exc, "response", None)
        status = getattr(resp, "status_code", None)

    retry_after = None
    resp = getattr(exc, "response", None)
    headers = getattr(resp, "headers", None)
    if headers is not None:
        try:
            raw = headers.get("retry-after")
            retry_after = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            retry_after = None

    if name == "AuthenticationError" or status in (401, 403):
        etype = "authentication_failed"
    elif name == "RateLimitError" or status == 429:
        etype = "rate_limited"
    elif name in ("BadRequestError", "UnprocessableEntityError") or status in (400, 422):
        etype = "bad_request"
    elif name in ("InternalServerError", "APIStatusError") and status and status >= 500:
        etype = "server_error"
    elif name == "APITimeoutError":
        etype = "timeout"
    elif name == "APIConnectionError":
        etype = "connection_error"
    else:
        etype = "unknown_error"

    message = getattr(exc, "message", None) or str(exc)
    return AgentError(message, error_type=etype, status_code=status,
                      retry_after=retry_after)


def _extract_usage(usage):
    """Normalise ResponsesUsage to the repo's token field names."""
    if usage is None:
        return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    get = (lambda k: getattr(usage, k, None)) if not isinstance(usage, dict) \
        else usage.get
    return {
        "input_tokens": int(get("input_tokens") or 0),
        "output_tokens": int(get("output_tokens") or 0),
        "total_tokens": int(get("total_tokens") or 0),
    }


def _extract_sources(response):
    """Pull search_results items into a flat, ordered source list.

    `response.output_text` is the answer; source metadata lives in the
    `search_results` output items, and URL citations live in the text content
    `annotations`. Both are collected here.
    """
    sources = []
    seen = set()
    for item in (getattr(response, "output", None) or []):
        if getattr(item, "type", None) != "search_results":
            continue
        for r in (getattr(item, "results", None) or []):
            url = getattr(r, "url", None)
            if not url or url in seen:
                continue
            seen.add(url)
            sources.append({
                "url": url,
                "title": getattr(r, "title", None),
                "snippet": getattr(r, "snippet", None),
                "date": getattr(r, "date", None),
                "source": getattr(r, "source", None),
            })
    return sources


def _extract_citations(response):
    """Collect URL citations from output_text annotations."""
    citations = []
    seen = set()
    for item in (getattr(response, "output", None) or []):
        if getattr(item, "type", None) != "message":
            continue
        for part in (getattr(item, "content", None) or []):
            if getattr(part, "type", None) != "output_text":
                continue
            for a in (getattr(part, "annotations", None) or []):
                url = getattr(a, "url", None)
                if not url or url in seen:
                    continue
                seen.add(url)
                citations.append({
                    "url": url,
                    "title": getattr(a, "title", None),
                    "type": getattr(a, "type", None),
                })
    return citations


def _domains(sources, citations):
    out = []
    for entry in list(sources) + list(citations):
        url = entry.get("url") or ""
        m = re.match(r"https?://([^/]+)", url)
        if m:
            host = m.group(1).lower().lstrip("www.")
            if host not in out:
                out.append(host)
    return out


def classify_visibility(answer, sources, citations):
    """Classify SF's appearance. Returns one of the methodology categories.

    Returns `inconclusive` when there is no answer text to judge. Never returns
    `incorrect` — that is a human judgement recorded separately.
    """
    text = (answer or "").strip()
    if not text:
        return "inconclusive"

    lowered = text.lower()
    cited = any(SF_DOMAIN in (e.get("url") or "") for e in list(sources) + list(citations))
    mentioned = (SF_DOMAIN in lowered) or any(n in lowered for n in SF_NAMES)

    if cited:
        return "cited"
    if not mentioned:
        return "absent"

    for sentence in _SENTENCE_SPLIT_RE.split(text):
        s = sentence.lower()
        if SF_DOMAIN in s or any(n in s for n in SF_NAMES):
            if _RECOMMEND_RE.search(sentence):
                return "recommended"
    return "mentioned"


class AgentClient:
    """Thin, retrying wrapper over `client.responses.create`."""

    def __init__(self, api_key=None, timeout=DEFAULT_TIMEOUT_S, max_retries=MAX_RETRIES,
                 preset=None, model=None, tools=None, sleep=time.sleep):
        self._api_key = (api_key or _env_api_key()).strip()
        self.timeout = timeout
        self.max_retries = max_retries
        self.preset = preset if preset is not None else os.environ.get(
            "PERPLEXITY_AGENT_PRESET", DEFAULT_PRESET)
        self.model = model if model is not None else os.environ.get(
            "PERPLEXITY_AGENT_MODEL", "").strip()
        self.tools = tools
        self._sleep = sleep
        self._client = None

    @property
    def uses_model(self):
        """True when an explicit model id is configured, else preset mode."""
        return bool(self.model)

    def _sdk(self):
        if self._client is None:
            _require_key()
            try:
                from perplexity import Perplexity  # lazy: no import-time network
            except ImportError as exc:  # pragma: no cover - depends on env
                raise AgentError(
                    "The official Perplexity SDK is not installed. Install it with: "
                    "python3 -m pip install -r requirements.txt",
                    error_type="connection_error",
                ) from exc
            self._client = Perplexity(api_key=self._api_key, timeout=self.timeout)
        return self._client

    def _request_kwargs(self, input_text, instructions=None, response_format=None,
                        max_output_tokens=None, max_steps=None,
                        previous_response_id=None):
        kwargs = {"input": input_text}
        if self.uses_model:
            kwargs["model"] = self.model
            # Web grounding is a tool. In preset mode the preset supplies tools.
            kwargs["tools"] = self.tools if self.tools is not None \
                else [{"type": "web_search"}]
        else:
            kwargs["preset"] = self.preset
            if self.tools is not None:
                kwargs["tools"] = self.tools
        if instructions:
            kwargs["instructions"] = instructions
        if response_format:
            kwargs["response_format"] = response_format
        if max_output_tokens is not None:
            kwargs["max_output_tokens"] = max_output_tokens
        if max_steps is not None:
            kwargs["max_steps"] = max_steps
        if previous_response_id:
            kwargs["previous_response_id"] = previous_response_id
        return kwargs

    def ask(self, query, instructions=None, response_format=None,
            max_output_tokens=None, max_steps=None, previous_response_id=None):
        """Ask a web-grounded question. Returns a normalised result dict.

        Raises AgentError on failure so callers can record `inconclusive` and the
        correct error_type. Retries 429/5xx/connection errors up to max_retries,
        honouring Retry-After when the server supplies it.
        """
        client = self._sdk()
        kwargs = self._request_kwargs(query, instructions, response_format,
                                      max_output_tokens, max_steps,
                                      previous_response_id)
        attempt = 0
        while True:
            attempt += 1
            try:
                response = client.responses.create(**kwargs)
                break
            except Exception as exc:  # noqa: BLE001 - normalised into AgentError
                err = classify_error(exc)
                retryable = err.error_type in ("rate_limited", "server_error",
                                               "connection_error", "timeout")
                if not retryable or attempt >= self.max_retries:
                    raise err from exc
                delay = err.retry_after if err.retry_after is not None else 2 ** attempt
                self._sleep(min(delay, 60))

        answer = getattr(response, "output_text", "") or ""
        sources = _extract_sources(response)
        citations = _extract_citations(response)
        return {
            "ok": True,
            "response_id": getattr(response, "id", None),
            "model": getattr(response, "model", None),
            "status": getattr(response, "status", None),
            "answer": answer,
            "sources": sources,
            "citations": citations,
            "domains": _domains(sources, citations),
            "usage": _extract_usage(getattr(response, "usage", None)),
        }


def build_record(query, city, result, *, platform="perplexity_agent_api",
                 test_type="ai_platform", web_search="yes", ts=None,
                 confidence="medium", note=None):
    """Build one ai_visibility_history.jsonl record.

    Field names match the existing records in
    growth-engine/data/ai_visibility_history.jsonl so the file stays uniform.
    """
    ts = ts or _now_iso()
    if result.get("ok"):
        answer = result.get("answer") or ""
        classification = classify_visibility(
            answer, result.get("sources") or [], result.get("citations") or [])
        default_note = (
            "Perplexity Agent API (web-grounded) via official Python SDK; "
            f"model={result.get('model') or 'preset'}; "
            f"{len(result.get('sources') or [])} source(s), "
            f"{len(result.get('citations') or [])} citation(s). "
            "This IS an AI-platform result (the answer engine ran), unlike the "
            "conventional_proxy rows."
        )
        return {
            "ts": ts,
            "platform": platform,
            "test_type": test_type,
            "query": query,
            "city": city,
            "web_search": web_search,
            "straight_flush": classification,
            "top_results": result.get("domains") or [],
            "confidence": confidence,
            "note": note or default_note,
            "model": result.get("model"),
            "response_id": result.get("response_id"),
            "citations": [c.get("url") for c in (result.get("citations") or [])],
            "sources": [s.get("url") for s in (result.get("sources") or [])],
            "answer_sha256": hashlib.sha256(answer.encode("utf-8")).hexdigest(),
            "answer_chars": len(answer),
            "usage": result.get("usage"),
        }

    # Failure branch. Accept both shapes: AgentError.as_dict() puts the fields at
    # the top level, while a raw API error body nests them under "error".
    err = result.get("error") or result
    etype = _normalize_error_type(err)
    status = err.get("status_code") or err.get("code")
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
            f"Agent API call failed ({etype}"
            f"{', HTTP ' + str(status) if status else ''}). "
            "Recorded inconclusive per methodology: a failed test is not zero "
            f"visibility. {err.get('message', '')}"
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


def ask_and_classify(query, city, **client_kwargs):
    """Convenience: run one query and return (result_dict, record_dict)."""
    client = AgentClient(**client_kwargs)
    try:
        result = client.ask(query)
    except AgentError as exc:
        result = exc.as_dict()
    except Exception as exc:  # noqa: BLE001
        result = classify_error(exc).as_dict()
    return result, build_record(query, city, result)
