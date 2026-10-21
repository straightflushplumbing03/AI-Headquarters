# Integration Status — Straight Flush Growth Engine

Verified **2026-10-12** (daily run, executed 16:27–16:35 UTC) in the active
OpenHands Cloud environment; a check is only marked ✅ after an actual successful
call. Prior verification 2026-10-09.

> **Re-verified 2026-10-19 (Intelligence HQ re-creation).** `GET /api/automation/v1`
> returned 6 automations. The generation-1 HQ pair no longer exists, so both were
> re-created from the canonical prompts via
> `growth-engine/automations/deploy_intelligence_hq.py --deploy` (HTTP 201 each):
> `SFPL Intelligence HQ Daily 6 AM` (`df8e3c2d-1fac-47fb-9af2-38d59c8239c5`,
> `0 6 * * *` America/Los_Angeles) and `SFPL Intelligence HQ Weekly Review`
> (`d948c2e2-e4a4-49f1-a2e4-40fdf815faea`, `0 6 * * 1` America/Los_Angeles).
> Both `enabled: True`, `state: ACTIVE`, `repos` = this repo (`main`), `timeout` 1800 s.
> The 2026-10-15 `SFPL AI Headquarters Daily` (`1485d659-8663-4776-a507-db0fefed8483`,
> Mon/Wed/Fri) and the retry watchdog (`b946624c-79c2-40a6-be1b-258388a15fb4`) are now
> **INACTIVE**, leaving exactly one enabled daily content job. GitHub OK, GitHub Pages
> OK, crawler access OK (unchanged from 2026-10-15). Google Search Console, GA4, and
> GBP remain **not connected** (blocker unchanged - see P-002).

> **Re-verified 2026-10-13 (second pass):** search-provider resilience tested
> with a **different query set**. Brave returned **8 parseable pages, then an
> anti-bot challenge page** for every later query (a *more specific* mode than the
> earlier 429 — the block can now trigger after as few as ~8 queries). Fallback
> chain all failed this pass: DuckDuckGo **Lite** → 202, DuckDuckGo **HTML** → 202,
> **Bing** → 200 with no parseable organic anchors, **Mojeek** → 403,
> **Ecosia** → 403. Blocked queries recorded **`inconclusive`, never "absent"**.
> Site crawler access remains ✅ (no regression).

> **Re-verified 2026-10-13 (daily run):** crawler access ✅ **PASS**
> (`crawler_access_check.sh` exit 0 — Googlebot/Bingbot/GPTBot/OAI-SearchBot/
> ClaudeBot/PerplexityBot/Applebot + curl all 200, no `cf-mitigated`; ISSUE-001
> remains RESOLVED); key paths `/`, `/llms.txt`, `/llms-full.txt`, `/md/index.md`,
> `/services/leak-detection.html`, `/cities/laguna-niguel.html` → HTTP 200 ✅
> (ISSUE-001 AI-readable-file follow-up **deployed**). **Brave Search ⚠️ PARTIAL**
> — 9/9 queries returned 200/parseable, then HTTP **429**; sweep stopped per the
> Brave-only rule (10 queries deferred, not failed). Google Search Central primary
> docs ✅ 200. Google Search Console, GA4, and GBP remain **not connected** ❌
> (blocker unchanged — see P-002).

> **Phase 2 re-verified 2026-10-12 (inspection run):** `GET /api/automation/v1`
> 200 ✅ — HQ-D and HQ-W **enabled/ACTIVE**; `Growth Engine A`, `Scout`,
> `Strategist`, and `Sentinel` now **disabled** (consolidation complete).
> `PATCH {"timeout":3600}` → **HTTP 422** (platform cap 1800 s, re-confirmed).
> Google Search Central primary sources → HTTP 200 ✅ (3/3). Google Search Console,
> GA4, and GBP remain **not connected** ❌ (blocker unchanged — see P-002).

> **Re-verified 2026-10-12** (Intelligence HQ setup run): OpenHands automation API
> 200 ✅; GitHub repo/API ✅ (`gh`/REST, `GITHUB_TOKEN` present, repo read/write);
> active repo clone ✅ (`straightflushplumbing03/-Up2datewebsiteseo`, `main`);
> GitHub Pages ✅ (`status: built`, CNAME `straightflushplumbingoc.com`, source
> `main` `/`); Brave Search ✅ (7/7 queries parsed, 8th HTTP 429 rate-limited);
> Google Search Central primary docs ✅ (HTTP 200). Google Search Console, GA4,
> and GBP remain **not connected** ❌ (blocker unchanged — see P-002).

## Automations registered (verified 2026-10-12)

| Name | id | Cron (America/Los_Angeles) | State | Repo connected |
|---|---|---|---|---|
| `SFPL Intelligence HQ Daily 6 AM` | `5dc89b41-6880-40e6-950c-14a635f7bd62` | `0 6 * * *` (daily incl. weekends) | **ACTIVE** | `straightflushplumbing03/-Up2datewebsiteseo` |
| `SFPL Intelligence HQ Weekly Review` | `0582d219-de15-42c2-83b5-4bc92995edce` | `0 6 * * 1` (Mondays) | **ACTIVE** | same |

- Both use the prompt preset with `repos` = the production repo, `timeout` = 1800 s.
- Verified via `GET /api/automation/v1/{id}`: `enabled: True`, `state: ACTIVE`,
  `trigger.timezone: America/Los_Angeles`, `preset_metadata.repos` set.
- `next_run_at` is **not exposed** by this API version; scheduling is evidenced by
  `enabled` + cron + `last_triggered_at` (daily: `2026-10-12T06:09:19Z` from the
  verification dispatch).
- Superseded duplicate at the same 06:00 slot (`Growth Engine A: Morning AI Search
  Visibility`) is `INACTIVE`.

## Highest-value integrations to unlock

1. **Gemini API key** — a *real* AI-answer-engine visibility signal
   in-automation. `GEMINI_API_KEY` is now set and the daily run measures
   AI-platform visibility via `scripts/gemini_visibility.py`. **Caveat
   (ISSUE-032):** grounding is **not** on the Gemini 3.x free tier, so grounded
   Gemini calls return HTTP 429; the client falls back to a free
   Google-Search-grounded **Gemma** model and labels the row `engine: gemma`. To
   measure the true Gemini surface, enable billing (Tier 1 = 5,000 free grounded
   requests/month). Perplexity remains a paid second engine, optional.
2. **Google Search Console** — the only reliable source for organic impressions,
   clicks, query, and indexing/coverage data.
3. **Google Business Profile** — local pack visibility is a primary channel for
   "plumber near me" queries.

## Not available ❌

| Integration | Status | Needed to enable |
|---|---|---|
| Google Search Console | **not connected** | OAuth/API credentials or owner export; needed for impressions/clicks/indexing |
| Google Analytics 4 | **not connected** | GA4 property ID + API creds or owner report |
| Google Business Profile performance | **not connected** | GBP API access or owner export |
| Google Search AI Overviews / AI Mode | **not testable** | No SERP API key; SERP served as JS shell to curl |
| ChatGPT Search | **not testable** | chatgpt.com 403 to non-browser clients |
| Claude web search | **not testable** | not scriptable in this environment |
| Gemini web search (consumer app) | **not testable** | gemini.google.com not scriptable |
| Gemini Search API | **free, with Gemma fallback** | `GEMINI_API_KEY` is set. Grounding is **not** on the Gemini 3.x free tier (HTTP 429), so the client falls back to a free Google-Search-grounded **Gemma** model and labels the row `engine: gemma` (ISSUE-032). Client + CLI + tests committed (`growth-engine/gemini_search_client.py`, `scripts/gemini_visibility.py`). Enable the true Gemini surface with billing (Tier 1 = 5,000 free grounded requests/month). |
| Microsoft Copilot | **not testable** | — |
| Grok | **not testable** | — |
| Perplexity Agent API | **optional — key not set** | `PERPLEXITY_API_KEY` missing. Metered, no free tier; a paid second engine. Client + CLI committed (`growth-engine/ai_agent_client.py`, `scripts/perplexity_agent.py`). |
| Notification channel (email/Slack/etc.) | **not configured / not verified** | Owner-approved notification target; Slack MCP not enabled |
| Call tracking / lead data | **not connected** | Provider + creds |

## Partially working / intermittent ⚠️

| Integration | Issue |
|---|---|
| Tavily Search API (conventional proxy) | **connected & verified** | `TAVILY_API_KEY` set. Live 10-query sweep 2026-10-15 returned 10/10 HTTP 200, 0 errors. Replaces Brave/DDG scraping. Client: `growth-engine/tavily_search.py` |
| Brave Search scraping | **superseded** | HTTP **429** to our egress IP after ~7-8 queries. Tavily replaces it. |
| Bing search scraping | HTTP 200 returned but organic anchors not reliably parseable here |
| DuckDuckGo HTML | 202 (anti-bot/rate-limit) on prior runs; Lite endpoint worked 2026-10-12 |

## Secrets handling

Never print secret values into reports or logs. The automations reference
`OPENHANDS_API_KEY` / `GITHUB_TOKEN` by name only; outputs shown in this repo
are redacted.
## Working ✅

| Integration | Evidence | Notes |
|---|---|---|
| OpenHands automation API | `GET /api/automation/v1?limit=1` → 200 (2026-10-12) | `OPENHANDS_API_KEY` present |
| GitHub (repo + API) | `GET /api/github.com/user` → `straightflushplumbing03` (2026-10-12) | token available as `github_token` / `GITHUB_PERSONAL_ACCESS_TOKEN`; repo read/write + PRs |
| Active repo clone | `git fetch origin main` → clean | `straightflushplumbing03/-Up2datewebsiteseo`, branch `main` |
| GitHub Pages deployment | Pages API: `status: built`, CNAME set | legacy build from `main` `/` |
| Site crawler access | `crawler_access_check.sh` exit 0; all UAs 200 (2026-10-12) | ISSUE-001 **resolved** — no `cf-mitigated` |
| DuckDuckGo Lite (conventional proxy) | 36/36 queries HTTP 200 with parseable results (2026-10-12) | Used for the 2026-10-12 visibility sweep |
| Bun/curl/dns/TLS checks | see `data/technical_health_history.jsonl` | |

