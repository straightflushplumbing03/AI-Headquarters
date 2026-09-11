# BUSINESS BRAIN / AI HEADQUARTERS — MASTER HANDOFF & CONTINUATION PLAN

> **Purpose of this document.** This is the single source of truth handed to the next engineer or
> AI agent working on this repository. It explains what the project is, what actually exists in the
> code, where work stopped, what is verified versus unverified, and exactly what to do next.
>
> **Read this first, then these, in order:**
> 1. `SPRINT_5_3_COMPLETION_REPORT.md` — the most current, honest ledger of the latest sprint.
> 2. `DEPLOYMENT_GUIDE.md` — deployment/environment procedures.
> 3. `docs/ROADMAP.md`, `IMPLEMENTATION_REPORT.md` — background, but **outdated** (see "Doc drift" below).
>
> **Warning about the marketing docs.** Root-level reports such as `README.md`,
> `IMPLEMENTATION_REPORT.md`, `COMPLETION_REPORT.md` claim "Production Ready", "7 Phases Complete",
> "100% test pass", and "Next.js 15 / React 19". **These claims are aspirational and stale.** The
> verified facts are: Next.js 14 / React 18, build/typecheck/lint/vitest green, **live database
> verification NOT yet performed**, and the Vercel production deployment was **not** confirmed
> healthy (see §6). Trust the code, the tests, and `SPRINT_5_3_COMPLETION_REPORT.md` — not the badges.
>
> **Doc drift.** There are near-duplicate report trees at the repo root and inside the untracked
> `isolate/` and `ai-headquarters/` prototype directories. Those two directories are **prototypes,
> excluded from the typecheck, not part of the app** — do not treat them as source of truth.

---

## 1. The Vision — DO NOT CHANGE THIS

Business Brain / AI Headquarters is intended to become an **AI-powered operating system for a
business**, not simply an AI chatbot.

The long-term vision: Business Brain understands the entire company, continuously monitors the
business, identifies opportunities and problems, makes decisions, asks for approval when necessary,
executes approved actions, measures the results, and learns from those results. For **Straight Flush
Plumbing & Leak Detection**, it should function like having a digital executive team working 24/7.

The system should eventually answer:

- What's happening in my business?
- Where are we losing money? Where are we making money?
- What should I do today?
- What are my competitors doing?
- What keywords should we target? What pages should we create?
- What marketing opportunities exist? Which leads are most valuable?
- What revenue is likely coming? What problems need attention?
- What should the AI do automatically? What requires Lance's approval?
- What happened after an AI action? Did that action work? What did the company learn?

**Guardrail:** every engineering decision must serve the operating-system vision, not a chatbot
side-quest. If a change doesn't move the business toward *monitor → decide → approve → execute →
measure → learn*, don't build it yet.

---

## 2. Repository & Stack (verified facts)

- **Repo:** `straightflushplumbing03/AI-Headquarters` (private). Last commit: `2116aad`.
- **Stack:** Next.js **14** (App Router) • React **18** • TypeScript ~5.3 • Tailwind CSS 3 •
  Supabase (`@supabase/supabase-js` ^2.38, `@supabase/ssr` ^0.0.10) • Vitest ~0.34 • Playwright
  config present • `engines.node: 20.x`.
- **Backend/database:** Supabase (PostgreSQL). 20 SQL migration files in `supabase/migrations/`.
  No other backend.
- **Structure (top level):** `app/` (33 files) • `lib/` (87 files) • `components/` (26 files) •
  `supabase/migrations/` (20 files) • `tests/` (16 files) • `scripts/` • `styles/` • `types/`.
- **Ignore:** untracked prototype dirs `isolate/` and `ai-headquarters/` (excluded from
  `tsconfig.json`, not part of the app), and `.next/`, `.vercel/` (gitignored).

---

## 3. What Has Already Been Built — DO NOT REBUILD

### Core platform (verified in code)
- ✅ Multi-tenant Next.js + Supabase app: org/tenant isolation, `organization_id` scoping.
- ✅ Supabase Auth (SSR cookie sessions) via `@supabase/ssr` — three clients, no duplicates:
  `lib/supabase/browser.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts`; root
  `middleware.ts` delegates and refreshes the session.
- ✅ RLS enabled on every org table (see `supabase/migrations/` — `000`→`016`, `002_enable_rls.sql`,
  org-isolation policies on each table, `WITH CHECK` on newer ones).
- ✅ User roles / permissions: `lib/auth/permissions.ts`, `lib/founder/permissions.ts`,
  server-route membership re-verification. **RLS is the final authority.**
- ✅ App UI: onboarding (org creation, 8-step wizard), headquarters hub
  (`app/headquarters/[id]/...`: dashboard, agents, tasks, goals, approvals, activity, memory,
  settings, hire, create-task, upload-logo), auth pages, dashboard.
- ✅ Approval center UI + API routes (`app/api/sprint3/approvals/*`), org verification route,
  auth session/logout routes.
- ✅ Company memory / knowledge + embedding/vector foundation: `lib/knowledge/*`
  (`embedding-service.ts`, `knowledge-service.ts`, `company-memory.ts`) + migrations
  `013_sprint52_knowledge_vectors.sql`, `014_sprint52_company_memory.sql`.

### AI infrastructure (verified in code)
- ✅ AI provider abstraction: `lib/ai/providers.ts` — OpenAI **and** Anthropic.
- ✅ Cost tracking & budgets: `lib/ai/cost-controller.ts`, `lib/ai/cost-manager.ts`,
  `lib/founder/founder-manager.ts`; `ai_usage_limits` spend ledger.
- ✅ Budget protection is now **database-atomic** (Sprint 5.3 P2): migration
  `016_sprint53_atomic_budget_reservation.sql` + `lib/sprint3/budget-reservation.ts`
  (`reserve_budget_idempotent` / `settle_budget_clamped` / `release_stale_budget_reservations`,
  all `FOR UPDATE` fail-closed). The old read-modify-write budget path is gone from the spend path.
- ✅ AI CEO / orchestrator foundation: `lib/ai-headquarters-platform.ts`,
  `lib/phase3/ceo-orchestrator.ts`.
- ✅ Founder controls: `app/api/founder/ai-budget/`, `app/api/founder/emergency-stop/` (server-only,
  service-role).

### AI workforce (6 coordinated roles exist as agents)
`lib/agents/`: `competitive-intelligence-agent.ts`, `seo-strategist-agent.ts`,
`content-strategist-agent.ts`, `website-optimization-agent.ts`, `local-seo-agent.ts`,
`analytics-agent.ts`, plus `registry.ts`. These are the intended "AI employees"; they are currently
individual agents, **not yet a coordinated team** — coordination is future work (see §8).

### Phases 1–7 engine foundation (in `lib/`)
- `lib/phase3/` (sprint3 enforcement: `workflow-engine`, `scheduler`, `priority-engine`,
  `knowledge-system`), `lib/phase4/` (executive dashboard, daily briefing, competitor watchtower,
  decision logger, self-diagnostics, straight-flush-initializer, github-integration),
  `lib/phase5/` (predictive: revenue-forecast, opportunity-engine, recommendation-engine,
  business-health, data-quality, early-warning, attribution, seo-opportunity,
  website-revenue-intelligence), `lib/phase6/action-execution-engine.ts`,
  `lib/phase6-7/system-health-monitor.ts`, `lib/ai/outcome-tracker.ts`, `lib/ai/execution-service.ts`,
  `lib/ai/execution-pipeline.ts`.
- **Predictive Business Intelligence (§4 of prior plan):** the `lib/phase5/*` services exist
  (forecasts, opportunity engine, business-health scoring) but, per the last honest review, this
  area **started but still requires verification/hardening** against real data before it can be
  trusted to produce "revenue trending 11% below target" style outputs.

### Sprint 5.3 — durable background jobs + atomic execution spine (verified in code)
This is the most recent completed sprint (P0/P1/P2 done; P3 live verification pending):

- **Durable Postgres-backed job queue** — migration `015_sprint53_background_jobs.sql`
  (`background_jobs` table, atomic `claim/complete/fail/requeue` SQL functions with
  `FOR UPDATE SKIP LOCKED`), `lib/jobs/` (`queue.ts`, `worker.ts`, `handlers.ts`, `maintenance.ts`,
  `types.ts`), endpoints `app/api/jobs/tick/route.ts` (bearer `CRON_SECRET`) and
  `app/api/jobs/enqueue/route.ts` (member-verified). Enqueue-once via unique
  `(organization_id, job_type, idempotency_key)`; exponential backoff 30s→…→1h; dead-lettering;
  stale-lease recovery; fail-closed kill switch (global + org pause).
- **Registered job types:** `approval_expiration_sweep`, `embedding_backfill`,
  `execute_autonomous_action`, `budget_reconciliation_sweep`.
- **Approval → execution is now connected:** `ApprovalManager.approveAction()` enqueues
  `execute_autonomous_action`; cron tick claims it and runs it through the engine asynchronously
  (no browser open). Three real engine bugs were found and fixed during this wiring (async
  idempotency deadlock, system-execution identity, audit-log column mismatch) — documented in the
  Sprint 5.3 report.
- **Scheduler:** `vercel.json` configures a Vercel Cron hitting `POST /api/jobs/tick` every minute
  (`* * * * *` — **requires Vercel Pro**; on Hobby use `0 0 * * *` or upgrade).

---

## 4. The Decision → Approval → Execution pipeline (completed §5 of prior draft)

The `ActionExecutionEngine` (`lib/phase6/action-execution-engine.ts`) was hardened in Sprint 5.3.
The actual execution order is:

```
AUTH → ORG MEMBERSHIP → PERMISSIONS → RISK → APPROVAL → KILL SWITCH →
  fast-fail completed-duplicate check (can only BLOCK) →
  ATOMIC BUDGET RESERVATION (reserve_budget_idempotent: FOR UPDATE, insert-or-reuse) →
  ATOMIC IDEMPOTENCY CLAIM → EXECUTE →
  SETTLE (actual cost, clamped by the DB) OR RELEASE (failure/block/shadow) →
  RECORD RESULT → AUDIT
```

And the durable path that makes it run without a browser:

```
approve (owner/admin) → enqueue execute_autonomous_action job →
  cron tick claims (CRON_SECRET) → ActionExecutionEngine re-runs every fail-closed check
  (risk, approval validity, kill switches, budget, atomic idempotency) →
  VERIFIED result on autonomous_actions + action_outcomes + audit
```

The live user-scoped route `POST /api/ai/execute` was also converted to the same atomic
reserve/settle pipeline (the last read-modify-write budget bypass).

---

## 5. Where We Stopped — EXACT STATE (as of this handoff)

### Verification state (honest, last full run)
| Check | Result |
|---|---|
| `npm run build` | ✅ exit 0 |
| `tsc --noEmit` (`npm run type-check`) | ✅ clean |
| `npm run lint` | ✅ pass (pre-existing warnings only) |
| `npx vitest run` | ✅ **126 passed / 0 failed / 10 skipped** (14 files; the 2 live-DB files correctly skip) |
| `budget-concurrency-live.test.ts` | 🔴 **6/6 skipped** — TEST env vars absent |
| `rls-live.test.ts` | 🔴 **52 probes skipped** — TEST env vars absent |
| Live migrations on a real Supabase project | 🔴 UNVERIFIED (no linked TEST project) |
| `/api/jobs/tick` end-to-end (cron → execution) | 🔴 UNVERIFIED (needs deployment + `CRON_SECRET`) |
| Vercel production deployment | 🟡 UNVERIFIED healthy — was failing with `MIDDLEWARE_INVOCATION_FAILED` because the `NEXT_PUBLIC_SUPABASE_*` vars were **not set on the Vercel project** (fix + env add pending redeploy) |

### Sprint 5.3 P3 (live verification) — BLOCKED, the single biggest open item
The three TEST-database credentials (`SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`,
`SUPABASE_TEST_SERVICE_KEY`) **never reached the test process** across many attempts (Keys-tab adds
+ session restarts). The live suites are env-gated and skip without them. **Do not mark skipped
tests as PASS. Do not point live tests at the production project.** The honest status of live budget
concurrency, live RLS, live background-job execution, and live migration application is
**UNVERIFIED** until real TEST-project credentials reach the test process.

### Repository cleanliness — CRITICAL, do this before switching
**A large amount of work is NOT committed.** As of the handoff snapshot:
- **71 modified files** (Sprint 1–7 source, middleware fixes, config, etc.)
- **26 untracked files/dirs**, including all of these important artifacts:
  - `supabase/migrations/000`, `010`–`016`, `sprint3_approval_status_widen.sql` (only 11 of the
    20 migrations are tracked)
  - `lib/jobs/`, `lib/sprint3/budget-reservation.ts`, `lib/knowledge/`
  - `app/api/jobs/`
  - Live test suites `tests/integration/budget-concurrency-live.test.ts`,
    `tests/integration/rls-live.test.ts` + 6 new unit test files
  - `SPRINT_5_3_COMPLETION_REPORT.md`, `vercel.json`, `.mcp.json`
  - (also untracked: prototype dirs `isolate/`, `ai-headquarters/` — optional to commit, but they
    should not go in unless intended)

**Action:** use the Freebuff Changes panel (Save → commit/push) or an explicit `git commit` to
persist the Sprint 5.3 work and this document **before** the account switch. If the repo is handed
over without a save, all of §3's newest infrastructure is absent from git history.

### Tooling / integration changes already made this cycle (in uncommitted working tree)
- `middleware.ts` + `lib/supabase/middleware.ts` — auth-route gating now derives from the real
  refreshed Supabase session (previously a hardcoded cookie name that never matched), plus a
  missing-env guard and try/catch around session refresh so middleware **cannot crash the whole
  site** when env vars are absent (this is the code half of the `MIDDLEWARE_INVOCATION_FAILED` fix).
- `vercel.json` — pins `installCommand: "npm install"` / `buildCommand: "npm run build"`
  (overrides a polluted dashboard Install Command that was breaking Vercel builds) + the cron entry.
- `package.json` — `engines.node` pinned to `20.x` (stops Vercel's "will auto-upgrade" warning).
- `.gitignore` — added `.vercel`.
- `tsconfig.json` — excludes the `isolate/` prototype (it had missing deps breaking `tsc`).
- `app/layout.tsx` — added `<SpeedInsights />` and `<Analytics />` (Vercel web analytics +
  speed insights; no keys needed; auto-enables only on Vercel deployments; must be toggled on in
  the Vercel dashboard → Analytics tab).
- `.mcp.json` — Supabase MCP dev server scoped to the AI Headquarters project
  (`https://mcp.supabase.com/mcp?project_ref=lxcrqbrjezsqrowajmsz` — **verify this ref is the
  AIHQ project**), browser-OAuth auth, no secrets in the repo.

---

## 6. Environment Variables (key inventory — no secrets here)

| Key | Used by | Where it must be set |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all Supabase clients | local `.env.local` **and** Vercel (Preview + Prod) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all Supabase clients (public) | local **and** Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only: `/api/jobs/tick`, `/api/founder/ai-budget`, `/api/founder/emergency-stop` | local **and** Vercel — never in browser code |
| `CRON_SECRET` | bearer auth on `/api/jobs/tick` | local **and** Vercel (same value) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | AI providers / embedding jobs | local **and** Vercel (if those jobs run in prod) |
| `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` / `SUPABASE_TEST_SERVICE_KEY` | live test suites only — **TEST project, never production** | Freebuff Keys tab / test process |
| `SUPABASE_PROJECT_REF` | `supabase link` + `npm run db:push` | dev machine |
| `VERCEL_TOKEN` (optional) | driving `vercel` CLI deploys | Keys tab if CLI deploys wanted |

**Naming note:** the app uses the legacy names (`NEXT_PUBLIC_SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY`). Supabase's newer naming (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` /
`SUPABASE_SECRET_KEY`) is **not** used. Do not migrate the naming unless Supabase actually deprecates
the legacy keys — the codebase is internally consistent and the migration is not required.

---

## 7. Verification Commands (how the next agent proves work)

```bash
npm run build          # Next.js production build
npm run type-check     # tsc --noEmit
npm run lint           # next lint
npx vitest run         # full suite (expect 126 passed / 10 skipped without live creds)
npx vitest run tests/integration/budget-concurrency-live.test.ts   # live: needs TEST creds
npx vitest run tests/integration/rls-live.test.ts                  # live: needs TEST creds
```

Live-DB tests only run when `SUPABASE_TEST_*` are in the **process env at test time**. No env-file
loader is configured in `vitest.config.ts`; vitest sees only real `process.env`.

---

## 8. What Comes Next — ORDERED

### Step 0 (do first, before anything else): SAVE THE WORK
Commit/push the uncommitted Sprint 5.3 + tooling changes (§5). Do not switch accounts first.

### Step 1: Finish Sprint 5.3 P3 — live verification against a dedicated TEST Supabase project
Never against production (`lxcrqbrjezsqrowajmsz` is the AIHQ project — do not run destructive or
migration work there unless explicitly authorized). Required:
1. Real TEST-project credentials in the test process (Freebuff Keys tab + full session restart, or
   supplied directly to the environment).
2. Apply the migration chain to the TEST database (migrations `000`–`016` in order) — verify 012,
   015, 016 apply cleanly and produce all objects (tables, indexes, RLS, policies, SQL functions).
3. `budget-concurrency-live.test.ts` — prove two concurrent $8 reservations against a $10 budget:
   one wins, one fails, reserved total never exceeds budget; verify idempotency + settlement.
4. `rls-live.test.ts` — 52 cross-tenant probes (SELECT/INSERT/UPDATE/DELETE, unauthenticated,
   nonexistent org, removed membership).
5. Background-job cycle against the live TEST DB + the deployed tick path with `CRON_SECRET`:
   create → claim → concurrent-claim exclusion → complete → fail/retry → backoff → dead-letter →
   stale recovery → idempotency.
6. Update `SPRINT_5_3_COMPLETION_REPORT.md` with PASS/FAIL/UNVERIFIED per item. **Skipped tests
   never count as PASS.**

### Step 2: Get the Vercel production deployment healthy
1. Set env vars on the Vercel project (Settings → Environment Variables) for Preview and
   Production: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, and the AI provider keys as needed.
2. Redeploy (env changes don't apply to existing deployments). Confirm no `MIDDLEWARE_INVOCATION_FAILED`.
3. Toggle on Web Analytics + Speed Insights in the Vercel dashboard if wanted (both are wired in
   `app/layout.tsx`).
4. Confirm the cron is accepted (Pro plan needed for `* * * * *`).

### Step 3: Predictive Business Intelligence hardening (§4 of the draft)
The `lib/phase5/*` services exist but were flagged as requiring verification/hardening against
real data before they can drive "revenue is trending X% below target → these three actions" output.
Next agent: unit/integration tests against seeded Straight-Flush-shaped data; verify the
forecast/opportunity/business-health services end-to-end; wire outcomes back into learning (§7).

### Step 4 (next-sprint candidates, in priority order — do NOT start without sign-off)
1. Outcome measurement + learning-loop jobs (Phase 6/7 connection; deferred from 5.3 scope).
2. Coordinated agent team: make the 6 workforce agents (`lib/agents/`) operate as a coordinated
   team (task handoff, shared context, escalation) instead of isolated agents.
3. Observability beyond console logging (structured logs / metrics sink).
4. Straight Flush onboarding: seed the real business profile, competitors, keywords, KPIs via
   `lib/phase4/straight-flush-initializer.ts` once predictive + learning are hardened.

### Hard "do nots" for the next agent
- Do not weaken RLS or remove `WITH CHECK` policies. Do not add duplicate Supabase clients.
- Do not expose service-role/secret keys to browser code. Do not commit secrets. Do not hardcode
  credentials.
- Do not run migrations or live tests against the production project. TEST project only.
- Do not mark skipped/env-gated tests as PASS. Do not claim live verification that hasn't run.
- Do not redesign the auth architecture or the migration numbering (015/016 are additive over 012 —
  never rewrite them; add 017+ if needed).
- Do not "fix" the marketing reports into green badges without re-verifying the underlying claims.

---

## 9. Owner decisions still needed (user input, not agent scope)

1. Confirm the Supabase project ref `lxcrqbrjezsqrowajmsz` is the correct AI Headquarters project
   (used in `.mcp.json`).
2. Provide dedicated TEST-project credentials for P3 live verification (Step 1).
3. Approve the Vercel plan: set env vars, redeploy, enable Analytics/Speed Insights, and whether
   the project is on Pro (minute cron) or Hobby (daily cron).
4. Business priorities for the 6 AI workforce roles and Straight Flush data seeding (Step 4).
5. Whether the `sb_secret_…` key shared earlier in chat was rotated (it was never persisted, but it
   was exposed in conversation and should be considered compromised).
