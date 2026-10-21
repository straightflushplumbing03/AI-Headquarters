# Straight Flush AI Headquarters — Implementation Sketch

**What this is:** the concrete build plan that turns the master prompt into a running system.
It is grounded in what already exists in your repositories, so it adds rather than replaces.

---

## 1. What already exists (do not rebuild)

| Layer | Where it lives | State |
|---|---|---|
| Next.js app + UI shell | `AI-Headquarters/app/` (dashboard, headquarters, authority views) | Built |
| AI Authority Engine schema | `AI-Headquarters/supabase/migrations/021_ai_authority_engine.sql` | Built; seed RPC idempotent (5 cities × 4 services = 20 markets) |
| Engine adapters (ChatGPT, Gemini, Perplexity, Grok, Google-as-unsupported) | `AI-Headquarters/lib/authority/adapters/` | Built; **no real AI response processed yet** |
| Query generator, runner, parser, citation intelligence, scoring, opportunity engine, experiment service, competitor intelligence, crawler, technical SEO, guardrails, cost control, integrations (GSC + GBP) | `AI-Headquarters/lib/authority/` (30 modules) | Built; unit-tested |
| Authority API surface | `AI-Headquarters/app/api/ai-authority/` (21 routes) | Built |
| Background jobs + atomic budget reservation | `supabase/migrations/015,016`, `app/api/jobs/tick/route.ts`, `vercel.json` cron `* * * * *` | Built |
| Approval + kill switch | `app/api/sprint3/approvals/*`, `app/api/founder/emergency-stop/route.ts` | Built |
| Phase 6/7 autonomous engine, learning, memory | `AI-Headquarters/lib/phase6`, `lib/phase7` | Built |
| Knowledge base + growth engine | `-Up2datewebsiteseo/growth-engine/` (knowledge docs, JSONL history, daily/weekly report templates, crawler check, cloudflare audit) | Operating since 2026-10-09 |
| Website | `-Up2datewebsiteseo/` — 133 HTML pages, 74 sitemap URLs, 21 city pages, `llms.txt`, `llms-full.txt`, `/md/` mirrors, JSON-LD | Live on GitHub Pages (CNAME `straightflushplumbingoc.com`) |
| Python SEO toolkit | `-Up2datewebsiteseo/scripts/` (25 generators + `seo_audit.py`) and `SEO-AI-SF/` (db, audit engine, ai_visibility, review miner, weekly report) | Built |

**Duplication risk to avoid:** three overlapping things already exist —
`AI-Headquarters/lib/authority` (TypeScript), `-Up2datewebsiteseo/growth-engine` (Markdown + JSONL),
and `SEO-AI-SF` (Python + Postgres). Pick **one** system of record and point the others at it.

**Recommended decision:** make `-Up2datewebsiteseo/growth-engine/` the *knowledge and evidence
store* (it is git-native, already running, and survives agent restarts), and make
`AI-Headquarters/lib/authority` the *execution engine* (it has adapters, cost control, and
approvals). Do **not** stand up a third store. Treat `SEO-AI-SF` as a library of useful scripts
to port, not a parallel system.

---

## 2. Target architecture

```
                          ┌─────────────────────────────────────────┐
   06:00 America/Los_Angeles  OpenHands Automation (prompt preset)  │
                          │  cron 0 6 * * *  ·  repos: HQ + SITE     │
                          └───────────────┬─────────────────────────┘
                                          │  starts one agent conversation
                                          ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  Sandbox (fresh each run)                                                 │
   │                                                                           │
   │   A. Discover    sitemap.xml → cities/*.html → SERVICE_AREAS.md           │
   │   B. Measure     crawler_access_check.sh · seo_audit.py · live HTTP sweep │
   │   C. Query       adapters: Perplexity ▸ ChatGPT ▸ Gemini ▸ Grok           │
   │                  (Google/Copilot/Claude/Apple → unsupported/unverified)   │
   │   D. Compare     competitor matrix · citation source graph                │
   │   E. Prioritize  impact × evidence × effort × cost × risk × measurability │
   │   F. Implement   branch → minimal change → tests → PR (never merge)       │
   │   G. Persist     reports/daily/<date>.md · data/*.jsonl · EXPERIMENT_LOG  │
   └──────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
   ┌──────────────────────┐   ┌─────────────────────────┐   ┌──────────────────┐
   │ GitHub: SITE repo    │   │ GitHub: HQ repo         │   │ Supabase         │
   │ knowledge + reports  │   │ engine code + PRs       │   │ authority schema │
   └──────────────────────┘   └─────────────────────────┘   └──────────────────┘
```

Two data planes, deliberately separated:

- **Evidence plane (git)** — append-only JSONL plus dated Markdown. Cheap, diffable, survives
  restarts, reviewable in a PR. This is the memory.
- **Query plane (Supabase)** — normalised tables for engines, queries, responses, citations,
  scores, markets, experiments. This is the queryable history.

The JSONL and Supabase rows must share a stable key so they can be reconciled:
`(query_hash, platform, run_date)`.

---

## 3. Build phases

### Phase 0 — Baseline and freeze (day 1, no risk)

| Task | Deliverable | Acceptance test |
|---|---|---|
| Confirm the automation API sees your org | `GET /api/automation/v1` returns your automations | HTTP 200 and the expected ids listed |
| Confirm repo write access | Clone both repos, push a no-op branch | Branch pushed, PR opened |
| Re-verify live site | 74 sitemap URLs swept for HTTP 200 | Report with per-URL status |
| Re-run crawler check | `bash growth-engine/tests/crawler_access_check.sh` | Exit 0, all UAs 200, no `cf-mitigated` |
| Record the baseline | Append to `data/technical_health_history.jsonl` | One JSON object appended, committed |

**Do not change anything in Phase 0.** The purpose is a trustworthy starting measurement.

### Phase 1 — Make the AI engines real (highest leverage)

This closes the single biggest gap: the engine has never processed a real AI response.

1. Add `PERPLEXITY_API_KEY` (returns citations natively — highest signal per dollar).
2. Run `lib/authority/query-runner.ts` against a fixed 20-query suite from
   `growth-engine/KEYWORD_UNIVERSE.md`, weighted to Laguna Niguel, Mission Viejo, Dana Point,
   Aliso Viejo, Laguna Hills.
3. Parse with `lib/authority/response-parser.ts`; persist citations via
   `lib/authority/citation-intelligence.ts`.
4. Append the same observations to `growth-engine/data/ai_visibility_history.jsonl`.

Acceptance test: at least one real response stored per configured engine, with a non-null
citation list where the provider returns one, and **zero** fabricated entries.

### Phase 2 — Platform playbooks

Create `growth-engine/platform-playbooks/<platform>.md` for each surface, each containing:
documented behaviour (with source URL), sources it appears to use, how Straight Flush is
currently represented, blockers, legitimate opportunities, recommended actions, required
access, measurement method, known limitations, last review date.

Acceptance test: every claim in every playbook is labelled `DOCUMENTED`, `OBSERVED`, or
`HYPOTHESIS`.

### Phase 3 — Service-area inventory

Extend `growth-engine/SERVICE_AREAS.md` into a machine-readable
`growth-engine/data/service_areas.json` keyed by city slug, containing the 21 discovered cities
plus any newly discovered ones, each with verified service availability, page URL, intent,
target terms, competitors seen, visibility data, gaps, and recommended actions.

Acceptance test: a validator script confirms every city slug has a matching page in
`cities/` and that no page is orphaned.

### Phase 4 — Measurement unlock (the real bottleneck)

Without these, every report will keep saying `UNMEASURED`:

| Integration | How to unlock | Cost |
|---|---|---|
| Google Search Console | Service account + `webmasters.readonly` scope, then add it as a user on the property. There is **no official Google GSC MCP server** — use the official API directly (already wired in `lib/authority/integrations.ts`) or a community MCP server. | Free |
| Google Analytics 4 | GA4 has an official Google MCP server. Add the measurement tag to the site. | Free |
| Bing Webmaster Tools | Generate an API key in Bing Webmaster Tools. | Free |
| Google Business Profile | Request GBP API access (quota is 0 until requested), or use owner exports. | Free |
| Call tracking | Provider of choice; keep numbers consistent with the canonical listing. | Paid |
| Notification channel | Slack bot token or email. The report/PR works until then. | Free |

Acceptance test: at least GSC and Bing connected, with one real metric pull recorded and dated.

### Phase 5 — Controlled implementation loop

Wire the existing guardrails so the daily run can open PRs but never merge, and never touch
public facts. Reuse `lib/authority/guardrails.ts`, `lib/authority/cost-control.ts`, and the
approval routes.

Acceptance test: a deliberately risky change (e.g. editing the phone number) is blocked and
queued for approval instead of committed.

### Phase 6 — Weekly and monthly cadence

- **Weekly** (`0 6 * * 1`): consolidate the seven daily reports, review experiments, prune
  duplicate PRs, update playbooks.
- **Monthly** (`0 8 1 * *`): full growth audit, roadmap re-prioritisation, cost review.

Acceptance test: one weekly and one monthly run complete with a report committed.

---

## 4. Repository layout to add

```
-Up2datewebsiteseo/
├── ai-headquarters-blueprint/
│   ├── README.md                     ← deployment guide + live automation ids
│   ├── 01-MASTER-AGENT-PROMPT.md      ← the prompt
│   ├── 02-IMPLEMENTATION-SKETCH.md    ← this file
│   └── 03-MCP-AND-INTEGRATIONS.md     ← MCP configs
└── growth-engine/
    ├── platform-playbooks/            ← NEW (Phase 2)
    │   ├── perplexity.md
    │   ├── chatgpt.md
    │   ├── gemini.md
    │   ├── grok.md
    │   ├── google-search-maps.md
    │   ├── bing-copilot.md
    │   ├── apple-maps.md
    │   └── directories.md
    ├── data/
    │   ├── service_areas.json         ← NEW (Phase 3)
    │   ├── ai_visibility_history.jsonl (exists, append-only)
    │   ├── competitor_observations.jsonl (exists)
    │   ├── technical_health_history.jsonl (exists)
    │   └── content_experiments.jsonl (exists)
    └── tests/
        └── validate_service_areas.py  ← NEW (Phase 3)
```

---

## 5. Cost model

| Item | Frequency | Notes |
|---|---|---|
| OpenHands automation run | 1/day | One agent conversation per run |
| Perplexity API | ~20 queries/day | Cheapest real AI-visibility signal |
| ChatGPT / Gemini / Grok | ~20 queries/day each | Optional; enable progressively |
| Supabase | continuous | Existing project `lxcrqbrjezsqrowajmsz` |
| GitHub Actions / Pages | on push | Free tier |
| Search Console / Bing / GBP | continuous | Free |

Controls already present in `AI-Headquarters`: monthly per-org AI budget, pre-execution check,
`PAUSE ALL AI` kill switch, atomic budget reservation. Keep them.

**Rule:** a run that would exceed the budget must degrade gracefully — skip the paid engine
queries and record them as `UNMEASURED`, never silently drop them.

---

## 6. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Two schedulers fight over the same content | High | One writer. Only the daily automation opens content PRs; the Vercel `jobs/tick` cron only processes the internal queue. |
| Fabricated AI observations | Critical | Adapter returns `unsupported` rather than guessing; parser rejects empty bodies; report statuses forbid inventing zeros. |
| Secrets committed | Critical | Reference by name only; the master prompt forbids printing; review every diff for `sk-`, `Bearer`, long base64. |
| Thin doorway city pages | High | New pages require substantial unique local information; validator rejects templated duplicates. |
| Cloudflare regression blocks crawlers again | High | `crawler_access_check.sh` runs every day; a `cf-mitigated` header is a critical alert. |
| Duplicate PRs | Medium | Search for an existing open PR on the same branch slug before opening. |
| Stale `main` in the sandbox | Medium | `git fetch origin main` + rebase before every push. |
| Agent merges its own PR | High | Explicit prohibition in the prompt; branch protection on `main` is the hard stop. |

---

## 7. Definition of done for the build

- [ ] Daily automation exists, is `ACTIVE`, and has completed at least 3 clean runs.
- [ ] At least one real AI-engine response stored per configured engine.
- [ ] All 21+ city pages audited in a single run.
- [ ] Service-area JSON validates and has no orphans.
- [ ] At least one measurement integration (GSC or Bing) returning real numbers.
- [ ] Experiment ledger has at least one entry with a real observed outcome.
- [ ] A risky change was correctly blocked and queued for approval.
- [ ] No secrets in any commit (verify with a secret scan).
