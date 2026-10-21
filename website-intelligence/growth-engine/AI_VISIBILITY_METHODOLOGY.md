# AI Visibility Methodology — Straight Flush Plumbing

**Purpose:** Make every visibility measurement reproducible and honest. A test
that was not actually executed is never reported as a result.

## Principles

1. **Evidence before changes.** Observe first, hypothesize second, change third.
2. **Never label a conventional search result as an AI-platform result.** Brave/
   Bing/Google organic listings are recorded as *conventional search*, not as
   ChatGPT/Claude/Gemini output.
3. **Missing ≠ zero.** If a platform cannot be tested, record `inconclusive` with
   the access limitation — never 0% visibility.
4. **Record exactly what happened:** query text, platform/interface, timestamp
   (+ timezone), intended city/context, web-search enabled (if known), raw
   answer/citations, named companies, SF appearance, position/context, cited URLs.

## Visibility categories (per query, per platform)

- **Recommended** — explicitly suggested for the requested service/area.
- **Mentioned** — named but not meaningfully recommended.
- **Cited** — our site or an attributable SF source is linked/cited.
- **First-party source surfaced** — the answer used our website as a source.
- **Absent** — SF does not appear.
- **Incorrect information** — material error about SF.
- **Inconclusive** — test failed, access unavailable, or result uninterpretable.

Track recommendation, citation, and mention rates **separately** — never merged
into one score.

## Platform status & access method (as of 2026-10-09)

| Platform | Access method | Testable today? | Notes |
|---|---|---|---|
| Google AI Overviews / AI Mode | Google SERP | **No** — JS-only shell via curl; no SERP API key | Use Google Search Console / manual browser session by the owner |
| ChatGPT Search | `chatgpt.com` | **No** — 403 to non-browser clients | Test manually in a logged-in session |
| Claude web search | claude.ai | **No** — not scriptable here | Test manually |
| Gemini | gemini.google.com | **No** — not scriptable here | Test manually |
| Microsoft Copilot | copilot.microsoft.com | **No** — not scriptable here | Test manually |
| Grok | grok.com / x.ai | **No** — not scriptable here | Test manually |
| **Gemini Search API** | `POST …/v1beta/models/{model}:generateContent` with `google_search` grounding | **Yes** — documented JSON API, free tier | **Primary AI-answer-engine measurement.** A genuine web-grounded answer + citations. Client: `growth-engine/gemini_search_client.py`; CLI: `python3 scripts/gemini_visibility.py --smoke`. Recorded `test_type: ai_platform`, `platform: gemini_search`. |
| **Gemma Search API (labelled fallback)** | same endpoint, a `gemma-*` model slug | **Yes** — free on the same key | **Only used when every Gemini model refuses grounding** (see below). Same Google Search index, so it is still a real web-grounded answer engine — but it is *not* the Gemini/AI-Overviews surface. Rows carry `engine: gemma` and `fallback_from`, so it is never mistaken for a Gemini result. Disable with `--no-fallback`. |
| **Claude web search (`claude_web_search`)** | Claude scheduled task: WebSearch, then the answer Claude would give | **Yes** — daily, no API key | **Primary daily AI-answer measurement from 2026-10-20.** Recorded in `data/citation_observations.jsonl` by `citation_engine.py`, with the URLs the answer relied on. It is Claude's answer surface only — never reported as ChatGPT/Gemini. |
| Perplexity Agent API | `POST https://api.perplexity.ai/v1/agent` | **Optional** — metered, no free tier | Second AI-answer engine when its key is set. Client: `growth-engine/ai_agent_client.py`; CLI: `python3 scripts/perplexity_agent.py --smoke`. Prefer the free Gemini path unless Perplexity is deliberately budgeted. |
| **Tavily Search API** | `POST api.tavily.com/search` | **Yes** — documented JSON API | **Primary** conventional-search proxy. Structured results, no scraping, no IP rate-limit. Client: `growth-engine/tavily_search.py`; CLI: `python3 scripts/tavily_search.py --smoke`. |
| Brave Search (superseded) | `search.brave.com/search?q=` | HTML scraping; **HTTP 429** after ~7-8 rapid queries | Replaced by Tavily. Retained only as a fallback. |
| Bing | `bing.com/search` | Partial — HTML returned but result anchors not reliably parseable in this environment | Retry with dedicated parsing |
| DuckDuckGo HTML | `html.duckduckgo.com/html` | Intermittent — 202 (rate-limit/anti-bot) | Retry later |

**Honest limitation:** as of 2026-10-09 the environment has no credentials for
any AI answer engine and no SERP API keys. AI-platform visibility is therefore
**unverified**, and the automations must say so rather than fabricate it. The
highest-value next step is to schedule a manual AI-visibility sweep (owner, in a
logged-in browser) or provision a Perplexity/SerpAPI key.

**Grounding availability (2026-10-19):** Google's pricing page lists grounding on
the **Gemini 3.x family as not available on the free tier**. A key created after
`gemini-2.5-flash` was retired can only reach 3.x models (`gemini-2.5-flash`
answers 404), so *every* grounded Gemini call returns HTTP 429
`RESOURCE_EXHAUSTED` even while the model quota is nearly unused. When that
happens the client falls back to a Google-Search-grounded **Gemma** model on the
same key and records `engine: gemma` + `fallback_from`. This keeps the AI surface
measured, free, and honestly labelled. The true fix remains either a paid Gemini
tier (Tier 1 gives 5,000 free grounded requests/month) or a key whose project can
reach a grounding-eligible Gemini model.

## Query universe

`KEYWORD_UNIVERSE.md` holds the query library (service × city × intent). Sampling
strategy: ~20–40 queries/day, weighted toward commercial value, historical
weaknesses, and queries not tested recently. Rotate so every core service and
priority city is covered regularly. Do not exhaustively permute every
service × city on every run.

## Sampling & comparability

- Keep query wording fixed for trend tracking; store the exact string.
- Where a platform gives no ordered list, do **not** report a "rank".
- Repeat tests for key queries before declaring a trend.
- Separate *test failure* (platform blocked) from *visibility failure* (SF absent).

## Metrics per platform / service / city / query family

Recommendation rate · mention rate · citation rate · first-party source rate ·
top-3 share (only when an ordered list exists) · competitor frequency · test
success rate · material-error count · change vs. previous comparable period ·
confidence (from sample size and quality).
