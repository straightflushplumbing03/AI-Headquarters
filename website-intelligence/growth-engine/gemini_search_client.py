#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gemini Search-grounded client — a free AI-answer-engine visibility measurement.

The daily run needs at least one *genuine* AI-answer-engine result: an assistant
that answers a customer-style question from live web sources and returns the
sources it used. Perplexity's Agent API does that but is metered and has no free
tier, so a run that is not worth paying for every day had none. This client is the
free substitute.

`google_search` grounding makes Gemini run a real web search and answer with
citations. Google bills grounding on the Gemini API free tier (up to ~500
grounded requests/day on Flash), and the token cost for Flash on the free tier is
zero, so a rotating sample of a few queries a day costs nothing.

FALLBACK — when Gemini refuses grounding, still measure (labelled). Google's
pricing page lists grounding on the Gemini 3.x family as **not available on the
free tier**, and a key created after 2.5 Flash was retired can only reach 3.x, so
every grounded Gemini call answers HTTP 429 `RESOURCE_EXHAUSTED` while the model
quota itself is barely touched. Rather than record the AI surface as UNMEASURED, a
Google-Search-grounded **Gemma** model (free on the same key, same Search index)
stands in — but the record always carries `engine` (`gemini` / `gemma`) and
`fallback_from`, so a Gemma answer is never mistaken for a Gemini one. Disable it
with `--no-fallback`.

HONESTY — this IS an AI-platform result.
Unlike Tavily (a ranked list of links, recorded `conventional_proxy`), Gemini
returns a synthesised answer *and* the grounding chunks it cited, so records are
written with `test_type: "ai_platform"` and `platform: "gemini_search"`, exactly
as the Perplexity rows are. The `engine` field names the model family that
actually answered.

Rules enforced here (see growth-engine/AI_VISIBILITY_METHODOLOGY.md):
  * A failed call is recorded `inconclusive` — never "absent" or 0%.
  * The key is read from an accepted env var and never printed, logged, or
    returned in any result dictionary.

Stdlib only: no SDK, no new dependency. Auth is the documented `x-goog-api-key`
header.

Examples
--------
    python3 growth-engine/gemini_search_client.py --smoke --query "plumber in Laguna Niguel"
    python3 growth-engine/gemini_search_client.py --run --dry-run
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
# `gemini-2.5-flash` was retired for new API keys and now answers HTTP 404, which
# silently turned every AI-visibility query into an inconclusive row. The
# `-latest` alias is maintained by Google across version bumps, so it does not
# rot the same way; the pinned versions below are tried in order if it is
# unavailable. See MODEL_FALLBACKS and GeminiClient._model_chain.
DEFAULT_MODEL = "gemini-flash-latest"
MODEL_FALLBACKS = ("gemini-3.8-flash", "gemini-3.5-flash", "gemini-2.5-flash")
# Grounding on the Gemini 3.x family is not on the free tier (Google pricing), and
# a post-2.5 key can only reach 3.x, so a grounded Gemini call 429s while the
# model quota is fine. This Gemma slug grounds on the free tier with the same
# Search index; it is used only as a labelled last resort. See GeminiClient.ask.
DEFAULT_FALLBACK_MODEL = "gemma-4-26b-a4b-it"
DEFAULT_TIMEOUT_S = 60
MAX_RETRIES = 3

# Quota refusals that mean "this model will not ground right now" — the cases the
# Gemma fallback exists for. A model-quota or billing 429 is the same signal.
GROUNDING_REFUSAL_TYPES = ("rate_limited", "server_error")

ERROR_TYPES = (
    "authentication_failed",
    "rate_limited",
    "bad_request",
    "server_error",
    "connection_error",
    "timeout",
    "unknown_error",
)

# OpenHands Cloud stores and injects secrets case-sensitively; accept the
# documented all-caps name and the platform-cased variant so a scheduled run does
# not record a false "key missing".
API_KEY_ENV_VARS = ("GEMINI_API_KEY", "GOOGLE_API_KEY", "Gemini_api_key")

SF_DOMAIN = "straightflushplumbingoc.com"
SF_NAMES = (
    "straight flush plumbing",   # covers "... Plumbing & Leak Detection"
    "straightflushplumbing",     # covers the URL slug / no-space spelling
)

_RECOMMEND_RE = re.compile(
    r"\b(recommend(?:ed|ation)?|best|top|excellent|trusted|reliable|"
    r"i would (?:choose|call)|go with|leading)\b",
    re.I,
)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")


class GeminiError(RuntimeError):
    """A failed Gemini call, carrying the repo's shared error taxonomy."""

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
        raise GeminiError(
            "No Gemini API key is set. Create one at https://aistudio.google.com/apikey "
            "and export it in your own shell: export GEMINI_API_KEY=...  "
            "Do not commit it.",
            error_type="authentication_failed",
        )


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


# Google returns {"error": {"code": 400, "status": "INVALID_ARGUMENT", ...}}.
_PROVIDER_STATUS_MAP = {
    "UNAUTHENTICATED": "authentication_failed",
    "PERMISSION_DENIED": "authentication_failed",
    "RESOURCE_EXHAUSTED": "rate_limited",
    "INVALID_ARGUMENT": "bad_request",
    "FAILED_PRECONDITION": "bad_request",
    "NOT_FOUND": "bad_request",
    "INTERNAL": "server_error",
    "UNAVAILABLE": "server_error",
    "DEADLINE_EXCEEDED": "timeout",
}


def _error_type_for(status_code, provider_status=None):
    if provider_status and str(provider_status).upper() in _PROVIDER_STATUS_MAP:
        return _PROVIDER_STATUS_MAP[str(provider_status).upper()]
    if status_code in (401, 403):
        return "authentication_failed"
    if status_code == 429:
        return "rate_limited"
    if status_code in (400, 404, 422):
        return "bad_request"
    if status_code and status_code >= 500:
        return "server_error"
    return "unknown_error"


def domain_of(url):
    m = re.match(r"https?://([^/]+)", url or "")
    return m.group(1).lower().lstrip("www.") if m else ""


def classify_visibility(answer, sources, citations):
    """Classify SF's appearance. Returns one of the methodology categories.

    Mirrors growth-engine/ai_agent_client.py so both AI clients label a run the
    same way. Never returns `incorrect` — that is a human judgement.
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


def _engine_of(model):
    """The model family that produced a result — `gemma` or `gemini`.

    Recorded per row so a Gemma fallback answer is never read as a Gemini one.
    """
    return "gemma" if (model or "").lower().startswith("gemma") else "gemini"


class GeminiClient:
    """Stdlib wrapper over `models/{model}:generateContent` with Search grounding."""

    def __init__(self, api_key=None, model=None, timeout=DEFAULT_TIMEOUT_S,
                 max_retries=MAX_RETRIES, sleep=time.sleep, opener=None,
                 model_fallbacks=None, allow_fallback=None,
                 fallback_model=None):
        self._api_key = (api_key or _env_api_key()).strip()
        self.model = (model or os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL).strip()
        # An explicit `model` or GEMINI_MODEL pins exactly one slug (so a bad
        # override fails loudly); the default resolves through the fallback chain
        # so a retired slug degrades instead of zeroing the day's AI sweep.
        if model or os.environ.get("GEMINI_MODEL"):
            self._models = [self.model]
        else:
            chain = model_fallbacks if model_fallbacks is not None else MODEL_FALLBACKS
            self._models = [self.model] + [m for m in chain if m != self.model]
        # Opt-in, and never when a model was pinned explicitly: an explicit model
        # is a request to test *that* model, so silently answering from another
        # engine would be a lie. Only the default chain falls back.
        if allow_fallback is None:
            allow_fallback = not (model or os.environ.get("GEMINI_MODEL"))
        self._allow_fallback = bool(allow_fallback)
        self.fallback_model = (
            fallback_model or os.environ.get("GEMINI_FALLBACK_MODEL")
            or DEFAULT_FALLBACK_MODEL).strip()
        self.timeout = timeout
        self.max_retries = max_retries
        self._sleep = sleep
        self._open = opener or urllib.request.urlopen

    def _endpoint(self):
        return f"{API_ROOT}/{urllib.parse.quote(self.model, safe='')}:generateContent"

    @staticmethod
    def _is_retired_model(err):
        """A 404 for a slug Google retired reads as a bad request but is not
        the caller's fault, so it is worth trying the next model."""
        return err.status_code == 404 and "no longer available" in str(err).lower()

    def _request(self, query, model):
        payload = {
            "contents": [{"parts": [{"text": query}]}],
            "tools": [{"google_search": {}}],
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{API_ROOT}/{urllib.parse.quote(model, safe='')}:generateContent",
            data=data, method="POST",
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": self._api_key,
                "User-Agent": "straight-flush-growth-engine/1.0",
            })
        return self._open(req, timeout=self.timeout)

    def ask(self, query):
        """Ask a Search-grounded question. Returns a normalised result dict.

        Raises GeminiError on failure so callers can record `inconclusive`.
        Retries 429/5xx/connection errors up to max_retries. A 404 for a slug
        Google has retired moves to the next model in the chain rather than
        failing the whole sweep.

        This never substitutes another engine; use `ask_with_fallback` for that.
        """
        _require_key()
        last_err = None
        for idx, model in enumerate(self._models):
            try:
                return self._ask_once(query, model)
            except GeminiError as err:
                last_err = err
                if not self._is_retired_model(err) or idx == len(self._models) - 1:
                    raise
                self.model = self._models[idx + 1]
        raise last_err

    def ask_with_fallback(self, query):
        """`ask`, then a labelled Gemma fallback when Gemini refuses grounding.

        Only a quota/server refusal triggers it — a bad request or an auth error
        is a real failure and is raised so the caller records `inconclusive`.
        """
        try:
            return self.ask(query)
        except GeminiError as err:
            if not (self._allow_fallback
                    and err.error_type in GROUNDING_REFUSAL_TYPES):
                raise
            result = self._ask_once(query, self.fallback_model)
            result["engine"] = _engine_of(self.fallback_model)
            result["fallback_from"] = self.model
            return result

    def _ask_once(self, query, model):
        attempt = 0
        while True:
            attempt += 1
            try:
                with self._request(query, model) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
                return self._normalise(body, query, model)
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", "replace") if exc.fp else ""
                provider_status = None
                try:
                    provider_status = (json.loads(raw).get("error") or {}).get("status")
                except Exception:  # noqa: BLE001 - body may be HTML from a gateway
                    provider_status = None
                etype = _error_type_for(exc.code, provider_status)
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                err = GeminiError(f"HTTP {exc.code}: {raw[:300]}",
                                  error_type=etype, status_code=exc.code,
                                  retry_after=float(retry_after) if retry_after else None)
            except urllib.error.URLError as exc:
                err = GeminiError(str(exc), error_type="connection_error")
            except TimeoutError as exc:
                err = GeminiError(str(exc), error_type="timeout")

            if err.error_type not in ("rate_limited", "server_error",
                                      "connection_error", "timeout") \
                    or attempt >= self.max_retries:
                raise err
            delay = err.retry_after if err.retry_after is not None else 2 ** attempt
            self._sleep(min(delay, 60))

    def _normalise(self, body, query, model):
        cand = (body.get("candidates") or [{}])[0]
        answer_parts = [p.get("text", "") for p in
                        ((cand.get("content") or {}).get("parts") or [])
                        if p.get("text")]
        answer = "".join(answer_parts).strip()

        meta = cand.get("groundingMetadata") or {}
        sources, seen = [], set()
        for chunk in (meta.get("groundingChunks") or []):
            web = chunk.get("web") or {}
            url = web.get("uri")
            if not url or url in seen:
                continue
            seen.add(url)
            sources.append({"url": url, "title": web.get("title"), "domain": domain_of(url)})
        citations = [{"url": s["url"], "title": s["title"], "type": "grounding"}
                     for s in sources]
        domains = []
        for s in sources:
            d = s.get("domain")
            if d and d not in domains:
                domains.append(d)

        return {
            "ok": True,
            "query": query,
            "model": model,
            "engine": _engine_of(model),
            "status": cand.get("finishReason"),
            "answer": answer,
            "sources": sources,
            "citations": citations,
            "domains": domains,
            "search_queries": meta.get("webSearchQueries") or [],
            "usage": body.get("usageMetadata") or {},
        }


def build_record(query, city, result, *, platform="gemini_search",
                 test_type="ai_platform", web_search="yes", ts=None,
                 confidence="medium", note=None):
    """Build one ai_visibility_history.jsonl record (same field set as the
    Perplexity rows so the file stays uniform)."""
    ts = ts or _now_iso()
    if result.get("ok"):
        answer = result.get("answer") or ""
        classification = classify_visibility(
            answer, result.get("sources") or [], result.get("citations") or [])
        engine = result.get("engine") or _engine_of(result.get("model"))
        fallback_from = result.get("fallback_from")
        default_note = (
            "Gemini API with Google Search grounding (free tier); "
            f"engine={engine}; model={result.get('model')}; "
            f"{len(result.get('sources') or [])} source(s), "
            f"{len(result.get('search_queries') or [])} search quer(ies). "
            "This IS an AI-platform result (the answer engine ran), unlike the "
            "conventional_proxy rows."
        )
        if engine == "gemma":
            default_note += (
                f" Grounding on the Gemini 3.x family is not on the free tier, so "
                f"this row came from the labelled Gemma fallback (from "
                f"{fallback_from}); a Google-Search-grounded answer on the same "
                "index, but not the Gemini/AI-Overviews surface."
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
            "engine": engine,
            "model": result.get("model"),
            "fallback_from": fallback_from,
            "response_id": None,
            "citations": [c.get("url") for c in (result.get("citations") or [])],
            "sources": [s.get("url") for s in (result.get("sources") or [])],
            "answer_sha256": hashlib.sha256(answer.encode("utf-8")).hexdigest(),
            "answer_chars": len(answer),
            "usage": result.get("usage"),
        }

    err = result.get("error") or result
    etype = err.get("error_type") or err.get("type") or "unknown_error"
    if etype not in ERROR_TYPES:
        etype = "unknown_error"
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
            f"Gemini call failed ({etype}"
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


def _shape(result):
    if not result.get("ok"):
        return {"ok": False, "error_type": result.get("error_type"),
                "status_code": result.get("status_code"),
                "message": (result.get("message") or "")[:200]}
    return {
        "ok": True, "model": result.get("model"), "engine": result.get("engine"),
        "fallback_from": result.get("fallback_from"), "status": result.get("status"),
        "answer_chars": len(result.get("answer") or ""),
        "answer_head": (result.get("answer") or "")[:160].replace("\n", " "),
        "sources": len(result.get("sources") or []),
        "domains": (result.get("domains") or [])[:10],
        "search_queries": result.get("search_queries"),
        "usage": result.get("usage"),
    }


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Gemini Search-grounded AI-visibility client (free tier).",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--smoke", action="store_true",
                    help="run one query and print a key-safe shape summary")
    ap.add_argument("--run", action="store_true", help="run the query suite")
    ap.add_argument("--query", default="plumber in Laguna Niguel",
                    help="query for --smoke")
    ap.add_argument("--queries-file", help="one query per line (overrides the suite)")
    ap.add_argument("--limit", type=int, help="cap the number of queries")
    ap.add_argument("--append", action="store_true",
                    help="append to growth-engine/data/ai_visibility_history.jsonl")
    ap.add_argument("--dry-run", action="store_true",
                    help="print the plan without any network call")
    ap.add_argument("--model", default=None, help="override the model slug")
    ap.add_argument("--no-fallback", action="store_true",
                    help="never substitute a grounding-capable model; a refused "
                         "Gemini call is then recorded inconclusive")
    ap.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S)
    ap.add_argument("--max-retries", type=int, default=MAX_RETRIES)
    args = ap.parse_args(argv)

    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    history = os.path.join(root, "growth-engine", "data", "ai_visibility_history.jsonl")
    default_queries = [
        ("plumber in Laguna Niguel", "Laguna Niguel"),
        ("best leak detection company in Laguna Niguel", "Laguna Niguel"),
        ("slab leak detection in Mission Viejo", "Mission Viejo"),
        ("emergency plumber in South Orange County", "South Orange County"),
        ("who can locate a hidden water leak in Laguna Niguel?", "Laguna Niguel"),
    ]

    if args.smoke:
        if not api_key_present():
            print("No Gemini API key set — export GEMINI_API_KEY in your own shell.",
                  file=sys.stderr)
            return 1
        client = GeminiClient(model=args.model, timeout=args.timeout,
                              max_retries=args.max_retries,
                              allow_fallback=(not args.no_fallback))
        try:
            print(json.dumps(_shape(client.ask_with_fallback(args.query)),
                             indent=2, ensure_ascii=False))
            return 0
        except GeminiError as exc:
            print(json.dumps(exc.as_dict(), indent=2, ensure_ascii=False))
            return 2

    if args.run:
        queries = default_queries
        if args.queries_file:
            with open(args.queries_file, encoding="utf-8") as fh:
                queries = [(ln.strip(), "") for ln in fh if ln.strip()]
        if args.limit:
            queries = queries[: args.limit]

        if args.dry_run:
            print(json.dumps({"dry_run": True, "model": args.model or DEFAULT_MODEL,
                              "history": os.path.relpath(history, root),
                              "queries": [q for q, _ in queries]},
                             indent=2, ensure_ascii=False))
            return 0
        if not api_key_present():
            print("No Gemini API key set — aborting without recording "
                  "(a missing key is not zero visibility).", file=sys.stderr)
            return 1

        client = GeminiClient(model=args.model, timeout=args.timeout,
                              max_retries=args.max_retries,
                              allow_fallback=(not args.no_fallback))
        records, summary = [], []
        for query, city in queries:
            try:
                result = client.ask_with_fallback(query)
            except GeminiError as exc:
                result = exc.as_dict()
            record = build_record(query, city, result)
            records.append(record)
            summary.append({"query": query, "city": city,
                            "straight_flush": record["straight_flush"],
                            "engine": record.get("engine"),
                            "model": record.get("model"),
                            "domains": (record.get("top_results") or [])[:5],
                            "error_type": record.get("error_type")})
            print(f"  [{record['straight_flush']:>13}] {query}", file=sys.stderr)
        print(json.dumps({
            "queries": len(queries),
            "succeeded": sum(1 for r in records
                             if r["straight_flush"] != "inconclusive"),
            "results": summary,
        }, indent=2, ensure_ascii=False))
        if args.append:
            n = append_records(history, records)
            print(f"\nAppended {n} record(s) to "
                  f"{os.path.relpath(history, root)}", file=sys.stderr)

        # The exit code must say whether the sweep measured anything. A sweep in
        # which every query errored measured nothing, yet used to return 0, so
        # `daily_measure` counted a blocked AI platform as a clean pass. The
        # inconclusive rows are kept (a failed test is not zero) but the outcome
        # is signalled: 3 = the platform refused every query (BLOCKED), 2 = some
        # other total failure (investigate). A Gemma fallback answer is a real
        # measurement, so it counts as `succeeded` and keeps exit 0. Guard on
        # `records`: an empty query list measured nothing and is not a failure.
        if records and all(r["straight_flush"] == "inconclusive" for r in records):
            platform_errors = {"rate_limited", "server_error",
                               "timeout", "connection_error"}
            error_types = {r.get("error_type") for r in records}
            if error_types and error_types <= platform_errors:
                print("Every grounded query was refused by the platform "
                      f"({', '.join(sorted(error_types))}) — recorded BLOCKED, "
                      "never zero.", file=sys.stderr)
                return 3
            print("Every grounded query failed — recorded inconclusive, not zero.",
                  file=sys.stderr)
            return 2
        return 0

    ap.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
