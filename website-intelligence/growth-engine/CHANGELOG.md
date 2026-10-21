# Growth Engine Changelog

Reverse-chronological. Documents creation and updates to the growth-engine
knowledge base so changes are auditable and reversible.

## 2026-10-19 — Claude takeover + AI Citation Engine

- Added `citation_engine.py` (+ 9 unit tests): plans rotating service × city
  recommendation queries, records AI answers with their cited sources, and ranks
  every source cited when Straight Flush lost into an action.
- First sweep (6 queries, `claude_web_search`): Straight Flush absent in 6/6; a
  lead-gen network (`homeservice.ignitionlabs.com`) was cited in all 6.
- Moved scheduled runs to Claude (`automations/claude-daily.prompt.md`,
  `claude-weekly.prompt.md`); owner chose direct commits to `main` behind the test gate.
- Added `.github/workflows/site-audits.yml` (Lighthouse CI + lychee, weekly).
- Cloudflare managed robots.txt AI-bot block removed by the owner (verified live 2026-10-19).

## 2026-10-19 — Intelligence HQ re-created (daily incl. weekends) + reproducible deploy script

The owner asked for the **Straight Flush Plumbing Intelligence HQ** to be present
and running as a named, persistent OpenHands Cloud system on a **daily 6:00 AM
America/Los_Angeles** schedule including weekends.

**Finding.** `GET /api/automation/v1` returned 6 automations. Neither
`SFPL Intelligence HQ Daily 6 AM` nor `SFPL Intelligence HQ Weekly Review` existed
(the generation-1 ids `5dc89b41…` / `0582d219…` are gone — 404). The 2026-10-15
redeploy had shipped under a different name (`SFPL AI Headquarters Daily`,
Mon/Wed/Fri) and was INACTIVE, so no daily content job was enabled.

**Added:**
- `growth-engine/automations/deploy_intelligence_hq.py` — reproducible deployment
  of both HQ automations from the canonical `*.prompt.md` files. Reads the prompt
  file (single source of truth), builds the payload, and applies it only with
  `--deploy` (dry-run by default). Deploys by name: an existing automation of the
  same name is PATCHed in place (stable id), otherwise it is created via the
  prompt preset.

**Created (live, HTTP 201):**
- `SFPL Intelligence HQ Daily 6 AM` — id `df8e3c2d-1fac-47fb-9af2-38d59c8239c5`,
  cron `0 6 * * *`, timezone `America/Los_Angeles`, timeout 1800 s, ACTIVE,
  `repos` = this repo (`main`), prompt 11,467 chars.
- `SFPL Intelligence HQ Weekly Review` — id `d948c2e2-e4a4-49f1-a2e4-40fdf815faea`,
  cron `0 6 * * 1`, timezone `America/Los_Angeles`, timeout 1800 s, ACTIVE,
  `repos` = this repo (`main`), prompt 3,167 chars.

Both read the latest committed knowledge base at the start of each run (fresh
sandbox per run; no reliance on local files), append dated findings without
deleting history, and persist back to a dated `intelligence-hq/…` branch with a PR.
Neither commits to `main` or deploys website changes.

**Updated:** `automations/README.md` (HQ table + re-creation section),
`INTEGRATION_STATUS.md` (2026-10-19 verification).

**Not changed:** no website page, schema, title, description, or copy; no change to
the production branch.

## 2026-10-19 — Gemini grounding unavailable on the free tier: labelled Gemma fallback (ISSUE-032)

Grounding with Google Search is **not on the Gemini 3.x free tier** (Google
pricing), and `gemini-2.5-flash` — the last free-grounding Flash — is retired for
new keys (404). So a post-2.5 key can only reach 3.x, where every grounded call
returns HTTP 429 `RESOURCE_EXHAUSTED` even while the model quota is nearly unused
(AI Studio showed 3/20). The client's fallback chain was all-Gemini, so it could
not escape the refusal and the whole AI-visibility sweep degraded to
`inconclusive`, leaving the AI surface UNMEASURED.

`growth-engine/gemini_search_client.py` now falls back, **when every Gemini model
refuses grounding**, to a Google-Search-grounded **Gemma** model on the same key
(same Search index, free). The substitution is never silent:

- rows carry `engine` (`gemini`/`gemma`) and `fallback_from`; the `note` says
  plainly that a Gemma row is not the Gemini/AI-Overviews surface;
- a pinned model (`--model` / `GEMINI_MODEL`) disables the fallback — an explicit
  model means "test that model";
- only quota/server refusals fall back; a 400/auth error still records
  `inconclusive`; `--no-fallback` turns it off entirely.

Verified live: `scripts/gemini_visibility.py --smoke` → `engine=gemma
model=gemma-4-26b-a4b-it fallback_from=gemini-flash-latest`, 12 sources, 3 real
Search queries; `--no-fallback` still returns `rate_limited`.

The same `main()` also gains the sweep-outcome exit code (folded in from PR #64,
which touched the same function): **3** = the platform refused every grounded
query (BLOCKED), **2** = other total failure, **0** = something was measured;
`scripts/daily_measure.py` maps 3 → BLOCKED and 2 → failure, so a blocked AI
surface is never counted as a clean pass. A labelled Gemma answer is a real
measurement and keeps exit 0. 24 new tests across the client and daily runner;
suite **343 tests OK**. The true fix (billing → 5,000 free grounded Gemini
requests/month, or a grounding-eligible key) is an owner spend decision.

## 2026-10-19 — System supervisor: fix two false FAILs, one blind PASS, one missing check (ISSUE-031)

The 2026-10-17 supervisor run (PR #65) reported `4/7` with three FAILs, but only one
was real. All four defects are in `scripts/system_supervisor.py`:

- `change_volume` counted `git log --numstat` **rows** (292) instead of **unique
  paths** (148), and scored a one-line `.html` edit as a new page (268 "additions" vs
  **0** via `--diff-filter=A`). Now counts unique paths and genuine new pages;
  `MAX_CHANGED_FILES` 120 -> 200 (a legitimate multi-file metadata pass reaches ~148).
- `unexpected_branches` flagged three branches that are the heads of merged PRs
  (#59/#61/#62). Now a branch is explained when it is (or was) a PR head.
- `self_merges` read `merged_by` from the GitHub *list* endpoint, which omits it, so it
  always PASSed. Now falls back to the single-PR endpoint, and with one collaborator
  reports **UNMEASURED (BLOCKED)** rather than a blind PASS.
- Added the missing `ai_visibility_blind` check (present in the live prompt, absent
  from the repo prompt and script). It FAILs when no `ai_platform` row exists or the
  newest is stale, so a conventional-search proxy is never mistaken for AI visibility.

`growth-engine/automations/ai-headquarters-supervisor.prompt.md` reconciled with the
live prompt. `test_system_supervisor.py` 10 -> 22 tests. Suite **321 tests OK**.

The two remaining FAILs are real owner-level items: the daily job is disabled
(`source: user`) and the Gemini grounding quota returns HTTP 429.

## 2026-10-15 — ISSUE-009 root cause corrected: runs die at the ceiling, not for lack of a sandbox

**Correction.** The earlier diagnosis on this branch read the platform error
`environment_unavailable` / "Timed out: Sandbox not available" as a transient
sandbox-provisioning failure and proposed a retry. That was wrong. Four failed runs
(all at the enforced ceiling, `started_at → timeout_at` ≈ 1920 s) show the error is a
**symptom of running out of clock**: the platform kills the run, tears down the
sandbox, and its post-run verification then reports no sandbox. The discriminator is
**elapsed time**, not the error string.

- Real fix (already on `main`, commit `897e7be`): `scripts/daily_measure.py`
  deterministic pre-stage (~5 s) + a prompt budgeted around the real ~1920 s ceiling.
  A dispatched run completed in **947 s**.
- `tests/classify_automation_run.py` now keys on elapsed time vs. the ceiling:
  `budget_overrun` (do NOT retry) vs. `sandbox` (retry once). Fixtures include the
  real `67e154d9` (no sandbox_id, 1926 s) as the case a naive rule gets wrong.
- The retry watchdog is now a narrow safety net: it re-dispatches only on a *fast*
  failure that never reached the ceiling.

**Updated:** `KNOWN_ISSUES.md` (ISSUE-009 root cause corrected), `automations/README.md`
(reliability section), `reports/daily/2026-10-13-incident-sandbox-failure.md`.

## 2026-10-15 — Entity consolidation: owned duplicates found and scoped

**Owner confirmation:** the Wix account and the base44 URL(s) are **owned** by
Straight Flush Plumbing & Leak Detection. ISSUE-014 moved from "blocked on
ownership" to "actionable".

**Added:**
- `growth-engine/ENTITY_CONSOLIDATION_PLAN.md` — verified findings, the four-host
  entity map, and the ordered remediation plan.
- `scripts/entity_consistency_check.py` — regression check for owned duplicates.
  Classifies each known host `canonical` / `live_duplicate` / `gone` / `noindex` /
  `unknown`; exits 1 while a live duplicate serves indexable content.
- `growth-engine/tests/test_entity_consistency_check.py` — 25 tests, no network.
- `growth-engine/data/entity_consistency_history.jsonl` — run history.

**Key findings (all verified live 2026-10-15):**
- `straight-flush-plumbing-7fb7cf71.base44.app` is a **live, indexable duplicate**:
  HTTP 200, `<meta robots>` `index, follow`, self-referencing canonical, `Allow: /`,
  and **48 URLs in its own sitemap** — mirroring the real site's services, adding
  18 city pages and **5 blog posts on the same keywords**. Zero links to the real
  site. Leftover template pages `/million-dollar-bet` and `/analytics` are still
  live and sitemapped.
- Its JSON-LD declares a **third domain** as the business identity —
  `@id: https://flush-pro-flow.base44.app/#business` — which currently returns
  **404**. A dangling entity reference.
- The Wix property `straightflushplumb8.wixsite.com` is already **404 + noindex**
  on every path tried. Cleanup only.
- Unverified claims on the duplicate that must not be republished: "24/7",
  "premier", "same-day".

**Wired into automation:** `morning-ai-search-visibility.prompt.md` step 1b runs
the entity check and reports; it explicitly may **not** change an external
property (Level 3, owner-only).

**Updated:** `KNOWN_ISSUES.md` (ISSUE-014 rewritten with the verified table),
`INTEGRATION_STATUS.md`.

**Not changed:** no website page, schema, title, description, or copy. No external
property touched. Steps 1–3 of the plan need owner go-ahead.

## 2026-10-15 — Tavily Search integration + first real visibility baseline

**Added:**
- `growth-engine/tavily_search.py` — Tavily Search client
  (`POST https://api.tavily.com/search`) over **stdlib `urllib` only** (no new
  dependency). Bearer auth, `Retry-After`-aware retries, and the repo's shared
  error taxonomy.
- `scripts/tavily_search.py` — CLI: `--smoke`, `--run`, `--append`, `--dry-run`.
- `growth-engine/tests/test_tavily_search.py` — 41 stdlib `unittest` tests; no
  network and no key required.
- `growth-engine/data/ai_visibility_history.jsonl` — **+10 rows** (186 → 196):
  the first reproducible conventional-search baseline.

**Why:** Brave rate-limited our egress IP with HTTP 429 after ~7-8 queries and
DuckDuckGo HTML intermittently returned 202 — both repeatedly cost the daily run
its research step. Tavily returns structured JSON from a documented API.

**Honesty properties enforced in code and tests:**
- Recorded as `test_type: conventional_proxy`, never as an AI-platform result.
- `include_answer` defaults to **off**: Tavily's synthesised answer is Tavily's
  own summarisation, not a consumer assistant's recommendation.
- `classify_visibility` can return only `cited` / `absent` / `inconclusive` —
  never `recommended`. A ranked list does not recommend.
- A failed call is `inconclusive`, never `absent`.

**Findings (recorded as ISSUE-014, ISSUE-015 — both OPEN, no change applied):**
- 10/10 customer-intent queries returned **zero** `straightflushplumbingoc.com`
  results (10/10 HTTP 200, no errors).
- A brand-name control query **did** return the real domain at rank 1, validating
  the matcher and proving the absence is genuine.
- That control query also surfaced **stale/competing** Straight Flush properties:
  `straightflushplumb8.wixsite.com` (Wix) and
  `straight-flush-plumbing-7fb7cf71.base44.app` (base44.app). Not previously
  recorded anywhere in the repo. Owner decision required (Level 3).

**Updated:** `AI_VISIBILITY_METHODOLOGY.md` (Tavily is now the primary
conventional proxy; Brave marked superseded), `INTEGRATION_STATUS.md`,
`KNOWN_ISSUES.md`, `PYTHON_DEPENDENCIES.md`.

**Not changed:** no website page, schema, title, description, or copy.

## 2026-10-15 — Perplexity Agent API integration (web-grounded AI visibility)

**Added:**
- `growth-engine/ai_agent_client.py` — Perplexity **Agent API** client
  (`POST https://api.perplexity.ai/v1/agent`) via the official SDK
  (`from perplexity import Perplexity`). Normalises the response to
  `output_text` + `search_results` sources + `output_text` annotations, maps
  SDK errors onto the repo's existing taxonomy (`authentication_failed`,
  `rate_limited`, `bad_request`, `server_error`, `connection_error`, `timeout`,
  `unknown_error`), honours `Retry-After`, and classifies visibility using the
  methodology's categories.
- `scripts/perplexity_agent.py` — CLI: `--smoke` (one query, key-safe shape
  summary), `--run` (curated 10-query suite from `KEYWORD_UNIVERSE.md`),
  `--append` (write evidence rows), `--dry-run` (no network).
- `growth-engine/tests/test_perplexity_agent.py` — 45 stdlib `unittest` tests;
  no network and no API key required.
- `requirements.txt` — the repo's first dependency file (`perplexityai>=0.43.8`).
- `growth-engine/PYTHON_DEPENDENCIES.md` — dependency + environment-variable notes.

**Updated:**
- `AI_VISIBILITY_METHODOLOGY.md` — Perplexity row now records the Agent API as
  the access method (code ready, key pending) instead of "JS app, not testable".
- `INTEGRATION_STATUS.md` — Perplexity moved from "not testable" to
  "code ready, key not set".

**Honesty properties enforced in code and tests:**
- A failed call is recorded `inconclusive`, never `absent` and never 0%.
- `incorrect` is never auto-assigned (it requires human judgement).
- The bare phrase "straight flush" is not treated as a brand match, so a
  namesake business is neither credited nor penalised.
- The API key is never printed, logged, or stored in any record.

**Not changed:** no website page, schema, title, description, or copy. No
`ai_visibility_history.jsonl` rows were written (the key is not yet configured).

## 2026-10-15 — Owner-requested local SEO audit + tooling fixes

**Added:**
- `reports/audit/2026-10-15-local-seo-audit.md` — full technical + local-SEO
  audit (10 required sections; confirmed issues vs. unverified concerns).

**Updated:**
- `scripts/refresh_sitemap.py` — fixed directory-hub URL handling (keeps `academy/`,
  `services/`, `case-studies/`, `insurance/` instead of `…/index.html`), made
  `<lastmod>` derive from the file's last git commit date, added `rel_of()`.
- `sitemap.xml` — refreshed `<lastmod>` to real last-change dates (git); no URLs
  added or removed.
- `growth-engine/tests/validate_knowledge_base.py` — added a
  sitemap-consistency check.
- `KNOWN_ISSUES.md` (ISSUE-010..013), `INTEGRATION_STATUS.md`,
  `data/technical_health_history.jsonl`.

**Not changed:** no website page, schema, title, description, or copy.

## 2026-10-13 — Blocker verification & fix pass

**Added:** scheduled-run verification evidence in `INTEGRATION_STATUS.md` (daily
cron run `1afcbefd` = 06:00:54 PDT and weekly cron run `ff3478a3` = 06:00:43 PDT,
both COMPLETED, daily opened PR #33); exact intended secret names for P-002/P-005;
a live schedule + deployment + access-blocker section in `README.md`.

**Updated:** `automations/intelligence-hq-daily.prompt.md` — explicit
**search-provider policy** (Brave → DuckDuckGo Lite → Bing, fall through once on
429/202) so the daily sweep no longer stalls on a blocked provider; measurement
step names the credential secrets and forbids reporting an unavailable metric as
zero; alert step cites P-005. `INTEGRATION_STATUS.md` deployment row corrected to
**GitHub Pages origin fronted by Cloudflare** (Cloudflare Workers build integration
runs on PRs; no `wrangler` config in repo). `proposals/…priority-actions.md`
P-002/P-005 statuses + secret names.

**Not changed:** no website page, schema, copy, or automation schedule.

## 2026-10-12 — Intelligence HQ setup (infrastructure + first run)

**Added:**
- `INDUSTRY_WATCH.md` — dated industry / official-guidance / diagnostic-technology watch.
- `INNOVATION_IDEAS.md` — idea register (≥5 new/day, evidence-scored, rejected ideas kept).
- `reports/weekly/TEMPLATE.md` — weekly strategic review template (Mondays).
- `reports/weekly/` and `reports/monthly/` directories.
- `automations/intelligence-hq-daily.prompt.md` and
  `automations/intelligence-hq-weekly.prompt.md` — canonical prompts for the
  **SFPL Intelligence HQ** automations.
- `reports/daily/2026-10-12.md` — first daily report from the Intelligence HQ run.

**Updated:** `README.md` (read order + file table), `automations/README.md`
(HQ-D/HQ-W registered), `KNOWN_ISSUES.md` (ISSUE-005 consolidation, ISSUE-006
run-budget), `INTEGRATION_STATUS.md` (this run's verification), `data/*.jsonl`
(append-only).

**Automations:** created `SFPL Intelligence HQ Daily 6 AM` (`0 6 * * *`,
America/Los_Angeles, id `5dc89b41-6880-40e6-950c-14a635f7bd62`) and
`SFPL Intelligence HQ Weekly Review` (`0 6 * * 1`, America/Los_Angeles, id
`0582d219-de15-42c2-83b5-4bc92995edce`) via the OpenHands Cloud automation API.
Automation A (superseded by HQ-D) disabled to prevent overlapping 06:00 runs.

**Run-budget fix (ISSUE-006):** the first manual dispatch
(`897c5d5a-6143-4133-a0e4-8501d62f0206`) **FAILED** with
`Timed out: command timed out or was killed` at the 1800 s (30 min) platform
ceiling — the agent spent the whole budget on open-ended research (testing Yahoo,
Bing RSS, Marginalia, headless Chromium, Google SERP pacing, blog crawls) and
never reached the write/commit step. Fix: the daily prompt now has a **mandatory
time budget** (40% research / 60% write+commit), restricts search to Brave (+ at
most one alternate), forbids headless browsers and multi-engine probing, and
instructs the agent to stop researching and commit when near budget. Note the
platform caps `timeout` at **1800 s** — a longer timeout is not available.
## 2026-10-12 — Daily run (HQ-D: 36-query sweep + industry/innovation files)

**Added:** `reports/daily/2026-10-12.md`, `INDUSTRY_WATCH.md` (dated, cited
industry + Google Search Central entries), `INNOVATION_IDEAS.md` (6 new
prioritized ideas).

**Updated:** `COMPETITOR_DIRECTORY.md` (36-query sweep: Tier A/B frequency,
14 new repeat competitors, aggregator dominance; counts recomputed from raw
results), `INTEGRATION_STATUS.md` (2026-10-12 verification). Appended observations
to `data/ai_visibility_history.jsonl` (36 rows), `data/competitor_observations.jsonl`
(35 rows), `data/technical_health_history.jsonl` (3 rows). Prepend to
`briefs/strategy-log.md`.

**Key findings:** ISSUE-001 remains **resolved** — all crawler UAs return 200.
Straight Flush absent from all 36 conventional-proxy (DuckDuckGo Lite) queries
(0/36). Provider rotated Brave → DuckDuckGo Lite (Brave now HTTP 429). AI answer
engines still unverified (no credentials). Repipe queries are specialist-dominated;
aggregators (yelp 32/36) dominate local discovery.

**Not changed:** no website pages, schema, or copy modified — read-only research +
additive documentation.

## 2026-10-15 — Technical SEO / AEO audit + fixes (OpenHands master task)

**Added:**
- `growth-engine/reports/baseline/2026-10-15-technical-seo-baseline.md` — pre-change
  baseline (live status codes, headers, robots/sitemap, schema, metadata inventory).
- `scripts/patch_city_meta.py`, `scripts/patch_city_internal_links.py`,
  `scripts/patch_case_study_integrity.py` (idempotent, evidence-gated fixers).
- `scripts/cloudflare_add_security_headers.py` (read-only by default; `--apply`
  gated on owner approval + Cloudflare token).

**Changed (all Level 2, verified):**
- `cities/*.html` — unique per-city title (≤60c) + description (120–160c) derived
  from each page's own content; 7 dead-anchor city chips now link the sibling city
  pages. New ISSUE-008, ISSUE-010.
- `index.html` — removed self-reported `aggregateRating` + `review` from the
  `Plumber` JSON-LD (resolves ISSUE-002).
- `sitemap.xml` — `lastmod` from real git commit dates; `case-studies/` section root
  now listed in canonical form. New ISSUE-009.
- `llms.txt` — ratings line now attributed to the business and flagged for
  confirmation on the live profiles.
- `growth-engine/tests/validate_knowledge_base.py` — added unique title/description,
  dead-fragment, and sitemap-sync invariants (the docstring previously promised a
  broken-link check that was not implemented).
- `growth-engine/KNOWN_ISSUES.md` — ISSUE-002 RESOLVED; added ISSUE-007 (security
  headers, blocked on CF token), ISSUE-008/009/010 (resolved), ISSUE-011
  (automation API returns 0 for this credential — investigate).

**Verification:** `seo_audit.py` (0 broken links, 0 invalid JSON-LD, 0 duplicate
indexable titles), `validate_knowledge_base.py` (133 files OK), crawler check PASS,
sitemap valid XML, 338 JSON-LD blocks parse. Core Web Vitals **unverified** —
PageSpeed Insights API returned HTTP 429 (quota, no key).

**Not changed:** `AGENTS.md`, approved-claims/business facts, the existing
automations, and no production deploy (no merge).

## 2026-10-15 (later) — SEO depth pass (title length + social cards)

**Added:** `scripts/patch_titles.py` (idempotent title shortener; asserts <=60c and
mutual uniqueness before writing).

**Changed (Level 2, verified):**
- **29 indexable pages** had titles of 61-89c → rewritten to <=60c keeping the
  primary keyword and intent; social `og:title`/`twitter:title` mirrors updated
  when they carried the same string. Now 0 indexable titles exceed 60c.
- `service-areas.html`, `academy/annual-plumbing-checkup-checklist.html` — added
  the standard Open Graph + Twitter card block (they were the only 2 indexable
  pages with no social metadata); uses the existing shared `og:image`
  (`assets/img/lance-hero.jpeg`), no new asset.
- `growth-engine/tests/validate_knowledge_base.py` — title <=60c and description
  <=165c guards added (a shorter title silently making two pages collide now
  fails the build).

**Verification:** `validate_knowledge_base.py` OK (133 files); `seo_audit.py`
0 duplicate indexable titles, 0 duplicate descriptions among indexables, 0 broken
links, 0 invalid JSON-LD; 0 indexable titles >60c.

**Reviewed, no change needed:** robots.txt (all crawlers incl. AI allow-listed,
sitemap declared), `404.html` (`noindex` + self-canonical — correct), heading
hierarchy (h2→h4 "skips" are 33 shared footer columns, site-wide by design; no
content-heading skips), click-to-call (all indexable pages have `tel:` links),
empty `alt` attributes (none). Case-study duplicate bodies are the intentional
noindex root stubs (ISSUE-004).

## 2026-10-11 — Daily run (visibility sweep + competitor refresh)

**Added:** `reports/daily/2026-10-11.md`.

**Updated:** `COMPETITOR_DIRECTORY.md` (28-query sweep: Tier A/B frequency,
6 new repeat competitors, aggregator dominance). Appended observations to
`data/ai_visibility_history.jsonl` (28 rows), `data/competitor_observations.jsonl`
(34 rows), `data/technical_health_history.jsonl` (crawler check = PASS). Prepend
to `briefs/strategy-log.md`.

**Key findings:** ISSUE-001 (Cloudflare crawler block) **confirmed resolved** —
all crawler UAs return 200. Straight Flush absent from all 28 conventional-proxy
queries (0/28). AI answer engines still unverified (no credentials).

**Not changed:** no website pages, schema, or copy modified — read-only research +
additive documentation.

## 2026-10-09 — Initial growth-engine baseline (OpenHands master automation)

**Added** (all under `growth-engine/`):
- `BUSINESS_PROFILE.md`, `SERVICE_CATALOG.md`, `SERVICE_AREAS.md`,
  `APPROVED_CLAIMS.md`, `BRAND_VOICE.md`, `COMPETITOR_DIRECTORY.md`,
  `KEYWORD_UNIVERSE.md`, `AI_VISIBILITY_METHODOLOGY.md`, `INTEGRATION_STATUS.md`,
  `KNOWN_ISSUES.md`, `EXPERIMENT_LOG.md`, `CHANGELOG.md`.
- `data/`: `ai_visibility_history.jsonl`, `competitor_observations.jsonl`,
  `technical_health_history.jsonl`, `content_experiments.jsonl`, `BASELINE_METRICS.json`.
- `reports/baseline/2026-10-09-baseline.md`, `reports/daily/` (template).
- `proposals/` (owner-approval items).

**Key findings:** Cloudflare 403 to all crawlers persists (ISSUE-001); Straight
Flush absent from all 5 tested conventional queries; Sterling competitor set
identified (Scott English, Efficient, Barker and Sons, Roto-Rooter, etc.).

**Not changed:** no website pages, schema, or copy were modified in this run.
This run is **read-only + additive documentation** only.
