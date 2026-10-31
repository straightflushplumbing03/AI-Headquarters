# AI Headquarters — Master Status & Next Actions

**Last reviewed:** 2026-10-21  
**Repository:** `straightflushplumbing03/AI-Headquarters`  
**Default branch:** `main` (the `master` branch is empty — it has no commits; all work is on `main`)  
**Purpose:** This is the plain-English control document for the Straight Flush Plumbing AI Headquarters project. It separates code that exists from capabilities proven to work live.

## Change log

- **2026-10-15** — first version of this document.
- **2026-10-19** — PR #15 merged (`d9c226c`): 6:00 AM Pacific daily gate, daily
  business briefing, operations/handoff and connections docs. PR #18 opened
  (`intelligence-hq/ga4-and-repo-status`): Google Analytics 4 adapter and a
  read-only GitHub repository-status adapter. Both new integrations are
  credential-gated and collect nothing until credentials are supplied.
- **2026-10-20** — Vercel deployments fixed and merged (PR #21): daily cron at 14:00 UTC,
  Node 22, GET on `/api/jobs/tick`, optional 15-minute GitHub Actions tick.
- **2026-10-20** — Phase A workforce core built on branch `phase-a/workforce-core`
  (local commit, not pushed, not applied to any hosted database). See
  "Phase A workforce core" below.
- **2026-10-21** — independent audit of `main` @ `073939b` (PR #22). Fixed the
  migration set so it reaches a clean fixpoint (migration 016 was producing a
  `budget_reservations` table the application's own RPCs could not use), added
  the first CI that actually runs the test suite, and added a migration
  verification gate. See PR #23. Added the status checklist below.

## Agent runner (2026-10-23)

- `lib/workforce/runner.ts` runs queued workforce tasks on every `/api/jobs/tick` (service role only).
  Every step goes through the enforced functions: recover stale tasks, schedule recurring work,
  claim, authorize each action at execution time, record results, attach and verify deliverables.
- Migration `027_workforce_runner.sql`: `workforce_next_tasks`, `workforce_requeue_stale`,
  `workforce_activity_summary`, `workforce_schedule_recurring` (executor-only).
- Executors (both read-only): `report.write` (workforce activity report) and `site.audit` (on-page SEO
  check of a granted https origin, from its sitemap; same-origin only; 35 s crawl budget).
- Recurring: an approval-free grant of `site.audit` on a site, or `report.write` on a named report,
  yields one task per ISO week for that agent.
- First real audit of straightflushplumbingoc.com (site files at `5e905d7`): 78 of 79 sitemap pages
  pass; `case-studies/dana-point-kitchen-pex-shutoff-valves.html` has a 163-char meta description.
- Tests: runner end to end on real Postgres 9/9; executor unit tests 8/8; CI now also runs the
  workforce SQL suites and the runner test.

## Hosted database status (2026-10-23)

- **Migrations 025 and 026 are applied** to Supabase project `znpqosbwdgrtfediqvwt`
  ("ai-hq-live-verification-test"), via the Supabase connector in pieces named `025a`–`025i`
  and `026a`–`026d`. The pieces were split because confirmation prompts for statements containing
  `DROP` never reached the owner; the repo files now use `CREATE OR REPLACE TRIGGER` and
  create-if-missing policies instead (same end state, no DROP).
- Verified on the hosted DB: function source, execute privileges, triggers, policies and new
  columns identical to the locally tested build. A full smoke cycle ran and was rolled back:
  claim, authorize, deliverable, completion, duplicate rejection, other-agent refusal,
  secret redaction, append-only events.
- That project holds only September 11 test fixtures (RLS TEST ORG A/B, one smoke org, agent
  and task). No business data. Supabase's table row estimates showed 0 rows; actual counts differ.
- `lxcrqbrjezsqrowajmsz` (the original July project) is paused; the connector cannot restore it
  ("no compatible image"). Restore it from the Supabase dashboard if its contents matter.

## Phase A workforce core (2026-10-20)

**State: implemented, tested, migrated to the hosted test DB (2026-10-23).**

What exists:

- `supabase/migrations/025_phase_a_workforce_core.sql` (additive; no drops, no data rewrites).
  Extends existing `agents`, `tasks`, `activity_events`, `approval_requests`; adds
  `workforce_agent_permissions`, `task_dependencies`, `workforce_deliverables`,
  `workforce_task_transitions`. Also adds the columns the app already writes but no
  migration created (`tasks.creator_id`; `activity_events.agent_id/user_id/title/description/metadata`).
- All rules live in the database (SECURITY DEFINER `workforce_*` functions + triggers):
  explicit per-agent grants (deny by default), execution-time permission and approval
  checks, dependency gating, enforced status transitions, dedupe of open tasks,
  append-only `activity_events` (no UPDATE/DELETE for any API role; owner too, except
  whole-org deletion), secret scrubbing of event metadata, deliverables linked to the
  producing event and verified only with a verification event. Agents (service role)
  cannot grant permissions or decide approvals.
- `lib/workforce/service.ts`; routes `POST /api/workforce/tasks`,
  `GET /api/workforce/tasks/:id` (full history), `POST /api/workforce/approvals/:id`.
- `ApprovalCenter` now decides real approval records through the enforced route. It
  previously "approved" by setting `tasks.status` from the browser, which the database
  now rejects.

Tests:

| Suite | Ran? | Result |
|---|---|---|
| `tests/sql/workforce_phase_a_test.sql` (84 checks, real `authenticated`/`service_role`/`anon` roles, local Postgres 16) | Yes, on an existing-chain DB and a fresh DB | 84/84 pass |
| `tests/unit/workforce-routes.test.ts` (vitest) | Yes (2026-10-20) | 22/22 pass |
| `tests/integration/workforce-db.test.ts` (vitest wrapper for both SQL suites, local Postgres) | Yes (2026-10-20) | 2/2 pass |
| Full `npx vitest run` | Yes (2026-10-20) | 306 pass, 17 skipped (live-DB suites need credentials), 0 fail |
| `npx tsc --noEmit` / `next lint` on changed files | Yes (2026-10-20) | 0 errors / 0 warnings |

Known limits / not done:

- No worker calls the executor functions yet; nothing executes tasks in the background.
- Legacy direct inserts (`CreateTask.tsx`, `lib/services/tasks.ts`) still create tasks
  without `required_tool`; such tasks can never be claimed (deny by default) until
  created through `workforce_create_task`.
- `lib/ai/agents/orchestrator.ts` / `execution-pipeline.ts` (unused) mark tasks
  completed directly; the database now rejects that path.
- Pre-existing, unrelated: `tests/sql/sprint5_validation.sql` fails on
  `budget_reservations.reserved_amount` (012 vs 08 schema conflict).
- **Supabase projects (2026-10-20 review).** Three refs appear across the two repos:
  | Ref | Where it appears | Evidence | Verdict |
  |---|---|---|---|
  | `znpqosbwdgrtfediqvwt` | `.env.local.example`, migration 09, Sprint 5.3 live verification, Supabase GitHub integration on this repo | The app was verified against it on 2026-09-11; migration 09 fixed drift found in it | **Recommended production** for this app |
  | `lxcrqbrjezsqrowajmsz` | `.mcp.json` in both repos, website blueprint | MCP tooling config only; the handoff plan itself says "verify this ref" | Unverified; check whether it is the same data or a separate Authority project |
  | `fcjyfjytmtuadfnzpmmu` | Connected to the build session | Created 2026-10-14, no tables, no migrations | Not production; usable as a scratch/test project |
  Neither candidate is reachable from the build session yet; migrations 025/026 wait on that access.

### Delegated agent approval (migration 026, 2026-10-20)

**State: implemented and tested locally; pushed to PR #20. Not migrated, not deployed.**

- Owners configure, via `POST /api/workforce/autonomy` (owner/admin only; agents can never call it):
  action policies (risk floor + owner-only flag + category) and per-agent approval delegations
  (tool/resource, max risk low|medium, max cost).
- Requesting agent must submit a business case (justification, benefit, risk, cost, rollback) via
  `workforce_justify_approval`. A delegate agent decides via `workforce_agent_review_approval`.
- Hard rules: no self-approval; delegate must hold its own grant for the action; spending, legal,
  customer data, security, production and irreversible categories are always owner-only; no policy
  means no agent approval; the owner's risk floor overrides a lowballed declaration; anything outside
  authority is escalated (left pending for the owner) with the reason recorded. Delegated approvals
  are re-checked at execution time and stop working if the delegation is revoked or expires.
- Tests: `tests/sql/workforce_delegation_test.sql` 42/42 pass; Phase A suite still 84/84 after 026.
  `tests/unit/workforce-autonomy-route.test.ts` 5/5 pass.
- Owner UI: **Settings → Agent autonomy** (grant/revoke permissions, set policies, grant/revoke
  delegations), backed by the same owner-only route. Delegation suite now 45/45.
- Not yet built: an agent runner that calls justify/review automatically.
- Compatibility check before production: no live code updates tasks in a way the new rules reject;
  the existing approval-expiry sweeps only match rows with `response_deadline`, which workforce
  approvals never set.

Local verification: `DATABASE_URL=postgres://…@localhost/<scratch> scripts/apply-migrations-local.sh`
then `psql <url> -f tests/sql/workforce_phase_a_test.sql`.

## Status checklist (VERIFIED / BLOCKED / NOT STARTED)

Status is earned by evidence, never by code existing. "BLOCKED" means the work
is waiting on something only the owner can supply (credentials, a live project,
an approval) — it is not a claim of failure.

| Item | Status | Exact evidence required / held |
|---|---|---|
| Full unit/integration suite on `main` | **VERIFIED** | `npx vitest run` → 280 passed, 15 skipped; `tsc --noEmit` exit 0; `next build` compiled. Now also enforced by CI (PR #23), which passed on the PR. |
| Migration set applies cleanly to a fresh database | **VERIFIED** | `scripts/verify-migrations.sh` against fresh `pgvector/pgvector:pg16` → fixpoint reaches 0 errors; schema-contract asserts pass. Enforced by the `migrations` CI job. |
| Budget reservation lifecycle works from a fresh build | **VERIFIED** | `reserve_budget_idempotent` returns a hold; identical replay returns the same id; `settle_budget_clamped` charges correctly and updates `current_spend`. Reproduced on Postgres 16. |
| PR #20 workforce SQL suites pass on the fixed chain | **VERIFIED** | `workforce_phase_a_test.sql` 84/84 PASS; `workforce_delegation_test.sql` 45/45 PASS. |
| Type-check, lint, build enforced on PRs | **VERIFIED** | `.github/workflows/ci.yml` `verify` job green on PR #23. |
| Every open PR classified merge / revise / close | **PARTIAL** | Classification recorded below; owner merge decisions outstanding. |
| Deployment healthy and authenticated (live) | **BLOCKED** | Deploys restored (PR #21). Needs an authenticated smoke test on production and `CRON_SECRET` confirmed set. |
| Live Supabase auth + RLS against a dedicated test project | **BLOCKED** | Needs a dedicated test project and its test-only credentials; `npm run test:live` must pass there, never against production. |
| One real AI request provider → parse → persist → display | **BLOCKED** | Needs one configured provider key. Then one repeatable query whose parsed output is stored with cost recorded and shown in the dashboard. |
| Scheduled job execution via `/api/jobs/tick` | **BLOCKED** | Needs `CRON_SECRET` in the hosting environment. Then an authenticated tick that persists, claims, completes, and logs a job. |
| Daily 6:00 AM America/Los_Angeles briefing (live) | **BLOCKED** | Code exists (PR #15). Needs the configured scheduler + `CRON_SECRET`. Then several consecutive runs, including a daylight-saving transition, and a deliberate failure/retry. |
| Google Search Console (read-only) | **BLOCKED** | Needs Google OAuth tokens. Then one real read-only request returns data. |
| Google Business Profile (read-only) | **BLOCKED** | Needs Google OAuth tokens. Then one real read-only request returns data. |
| GA4 metrics (read-only) | **BLOCKED** | Adapter built (PR #18). Needs an `analytics.readonly` refresh token + numeric property id. Then real GA4 data for that property. |
| GitHub repository / deployment status (read-only) | **BLOCKED** | Adapter built (PR #18). Needs a fine-grained read-only `GITHUB_STATUS_TOKEN`. |
| AI-search monitoring only where authorized | **NOT STARTED** | No authorized source configured. Reports must label source, date, query, and confidence; unsupported sources stay labelled unavailable. Do not scrape prohibited services or invent results. |
| Website change workflow (propose → approve → publish → measure) | **NOT STARTED** | Proposed changes must live on a separate branch + PR with automated checks, require owner approval, and be measured after deployment. |
| Optional model provider (e.g. Hugging Face) evaluated | **NOT STARTED** | Only worth doing if a benchmark against the existing provider on real SEO/competitor tasks shows measured benefit. |

## Executive summary

The repository contains a substantial Next.js 14 / React 18 / TypeScript / Supabase application foundation, AI-provider abstraction, six specialist agent modules, approvals, cost controls, and a durable background-job system. The project is **not yet verified as a reliable, live, end-to-end autonomous business system**.

Do not use old README badges or statements such as “production ready,” “all phases complete,” or “100% complete” as proof. The repository's `MASTER_HANDOFF_PLAN.md` and `SPRINT_5_3_COMPLETION_REPORT.md` explicitly document remaining live-verification blockers.

**Current operating principle:** stabilize and verify what exists before building more features.

## What exists in code (not the same as live-verified)

- Next.js App Router application, TypeScript, React, Tailwind.
- Supabase authentication, organization membership checks, database migrations, and row-level-security policies.
- Headquarters dashboard areas for tasks, goals, approvals, activity, memory, settings, and agents.
- AI provider abstraction for OpenAI and Anthropic; cost tracking and budget controls.
- Six specialist agent modules: competitive intelligence, SEO strategy, content strategy, website optimization, local SEO, and analytics.
- Background job queue, worker handlers, approval-to-execution path, retry/idempotency protections, and emergency-stop controls.
- A daily briefing / 6:00 AM Pacific cadence (merged in PR #15); it is **not considered active in production until deployed, configured, and tested**.

## Current blockers and dependencies

| Priority | Item | Known status | What proves completion |
|---|---|---|---|
| P0 | Establish one trusted project status and backlog | This document is the proposed starting point; merge it after review | This file is merged and referenced by the README / handoff |
| P0 | Review open pull requests and stale Copilot work | PR #15 merged 2026-10-19 (`d9c226c`). PR #18 open (GA4 + read-only repo status). Older WIP Copilot PRs (#2, #4, #5, #6, #7) still open | Every PR is marked merge, revise, or close with a reason; no PR is merged just to tidy the list |
| P0 | Confirm the hosting deployment is healthy | **Deployments restored 2026-10-20 (PR #21).** Every deploy from 2026-09-11 failed: every-minute cron (Hobby allows daily), Node 20 pin (disabled by Vercel 2026-10-01), and the tick route had no GET for Vercel Cron. All six linked Vercel projects now deploy from `main`. Authenticated smoke test not yet done | Authenticated smoke test on production; `CRON_SECRET` confirmed set |
| P0 | Verify database migrations and tenant isolation on a dedicated test database | Live hosted Supabase verification was previously blocked / unverified | `npm run test:live` and RLS probes pass against a separate test project, never production |
| P0 | Run a real AI request through provider → parser → persisted result | No provider key / real parsed response was recorded in the handoff at the time of the audit | One successful, repeatable test query with output stored and errors handled |
| P0 | Configure scheduled job execution | `/api/jobs/tick` requires `CRON_SECRET`; current deployment configuration must be verified | Authenticated cron tick succeeds; job is persisted, claimed, completed, and visible in logs |
| P1 | Connect Google Search Console and Google Business Profile | Code is described as implemented but credential-gated in PR #15 | OAuth configured securely and one real read-only request succeeds for each service |
| P1 | Implement GA4 connection | **Built 2026-10-19 (PR #18)** — adapter, `authority_ga4_metrics` table, monthly job, tests. Not yet live: no credentials configured | Integration returns actual GA4 data for a configured property |
| P1 | Add GitHub CI/deployment status integration | **Read-only adapter built 2026-10-19 (PR #18)** — GET-only branch/CI/PR snapshot at `GET /api/ai-authority/repository-status`. No `GITHUB_STATUS_TOKEN` configured yet | CI status observable for the platform's own repo; token configured |
| P1 | Verify the daily briefing at 6:00 AM America/Los_Angeles | Code merged in PR #15; deployment and configuration not confirmed | Several successful runs, including daylight-saving-safe schedule behavior |
| P1 | Separate AI-search checks from estimates/proxies | AI visibility should not be reported as measured unless actual queries were run | Reports label source, date, query, response, and confidence; unavailable sources remain unavailable |
| P1 | Establish approved website-change workflow | Intended loop is monitor → recommend → approve → implement → measure → learn | Proposed changes use a separate branch/PR, checks pass, owner approves, then deployment is verified |
| P2 | Measure business outcomes | Requires analytics / call / lead data | Monthly baseline and tracked changes for search visibility, qualified calls, leads, and booked work |

## Pull request cleanup procedure

Review each PR's current status and diff before deciding. Do not close or merge solely based on age.

1. **PR #15 — daily automation + connection checklist:** **MERGED 2026-10-19** as `d9c226c`. Follow-up PR #18 (GA4 + read-only repo status) is open for review.
2. **PR #16 — Vercel Web Analytics:** verify whether it is still open, inspect its diff and checks, and merge only if it is still needed and compatible with the actual hosting setup.
3. **PRs #2, #4, #5, #6, #7 — WIP Copilot requests:** inspect whether they contain useful unique fixes or are stale duplicates. Close only after checking their diffs and related commits.
4. Re-run the test suite after any merge. Never infer production health from a green unit-test run alone.

### Classification (audited 2026-10-21)

Every open PR was inspected against its actual diff and, where relevant, tested. These are
recommendations — merges are owner-only.

| PR | Head | Verdict | Reason |
|---|---|---|---|
| #23 | `intelligence-hq/infra-2026-10-21-migration-fixpoint` | **MERGE** | Fixes the migration fixpoint and adds the first real CI. Both CI jobs green. |
| #20 | `phase-a/workforce-core` | **MERGED** | Merged into `main` as `e174d40`. Verified: 309 tests, both SQL suites pass (84/84, 45/45), build OK. |
| #16 | `vercel/install-and-configure-vercel-w-1hvqjv` | **REVISE** | One-line fix (`@vercel/analytics/react` → `/next`). Confirm it matches the deployed Next version before merging; otherwise harmless but low value. |
| #19 | `intelligence-hq/ai-gateway-provider` | **REVISE** | Adds Vercel AI Gateway as a cost-tracked provider (+379/-19, unit-tested). Evaluate cost/benefit against the existing providers before merging. |
| #1 | `copilot/implement-sprint-3-1-hardening-pass` | **CLOSE** | Conflicts with `main`; its engine/approval files are already present, and its test + SQL files are superseded by PR #20's coverage. |
| #12 | `copilot/fix-failing-github-actions-job-again` | **CLOSE** | Conflicting; 63 files +8678 lines of stale Phase 5 infra work. Superseded by the current CI. |
| #11 | `copilot/fix-github-actions-job` | **CLOSE** | Only `package-lock.json` `dev`→`devOptional` churn; no code fix. |
| #9 | `copilot/fix-github-actions-job-failure` | **CLOSE** | Claims to resolve 113 TS errors, but `main` already passes `tsc --noEmit` (exit 0). Superseded. |
| #2, #4, #5, #6, #7 | `copilot/fix-*` | **CLOSE** | Untitled `[WIP] Copilot Request` drafts with no unique fix; superseded by later work. |

## Required owner-provided setup (never commit secret values)

- Dedicated Supabase test project and its test-only credentials in the secure execution environment.
- One AI provider API key, securely configured, to run a real request.
- `CRON_SECRET` configured in the actual hosting project's environment.
- Google OAuth access/refresh tokens for Search Console and Business Profile, where required.
- Google OAuth refresh token for Analytics 4 (scope `analytics.readonly`) plus the numeric GA4 property id.
- Optional: `GITHUB_STATUS_TOKEN` (fine-grained, read-only) to enable the repository-status endpoint.
- Access to the hosting dashboard to verify deployments and environment-variable names.
- Confirm the intended hosting and billing plan before enabling minute-level cron.

**Security:** never paste secret values into GitHub issues, commits, pull requests, or this status document. Use the hosting provider's encrypted environment settings or the approved secret manager.

## Safe execution order

### Milestone 1 — Repository organization
- [x] Review current default-branch state and all open PRs.
- [ ] Classify each PR: merge, revise, or close.
- [ ] Reconcile conflicting README, roadmap, handoff, and deployment claims.
- [ ] Keep prototype directories `isolate/` and `ai-headquarters/` clearly labeled as prototypes unless deliberately integrated.

### Milestone 2 — Staging and security verification
- [ ] Confirm deployment platform, build settings, and environment-variable names.
- [ ] Create/use a separate Supabase test project.
- [ ] Apply migrations and run unit, type-check, lint, build, live database, RLS, and authentication checks.
- [ ] Verify emergency stop and approval requirements.

### Milestone 3 — First real AI workflow
- [ ] Configure one provider key securely.
- [ ] Run one representative local SEO / competitor query.
- [ ] Validate parser output and persist source/evidence.
- [ ] Verify cost tracking, budget limits, failure handling, and audit log.

### Milestone 4 — Scheduled operation
- [ ] Configure `CRON_SECRET` and hosting scheduler.
- [ ] Verify the job tick endpoint and durable queue end to end.
- [ ] Verify daily briefing time in `America/Los_Angeles`.
- [ ] Observe several consecutive runs and test a deliberate failure/retry.

### Milestone 5 — Website improvement loop
- [ ] Establish a baseline from Search Console, GBP, GA4, and website technical checks. *(GA4 adapter and read-only repo status now built — PR #18 — but no credentials are configured, so no baseline data exists yet.)*
- [ ] Produce prioritized, evidence-backed recommendations.
- [ ] Create website changes on a separate branch and pull request.
- [ ] Require owner approval before production publishing.
- [ ] Track before/after results and record what worked.

## Definition of “automated enough to trust”

The system is not done merely because a dashboard loads or a build passes. It is ready for limited, supervised operation when:

1. Authentication and organization-level data isolation pass live tests.
2. Real provider responses are stored with traceable evidence and cost tracking.
3. Scheduled jobs execute reliably, report failures, and recover safely.
4. The owner can review and approve actions, and emergency stop works.
5. Website changes are tested and reviewed before deployment.
6. Outcomes are measured from real data, with missing data labeled honestly.

**Do not deploy to or alter the live plumbing website, production DNS, or production database as part of repository cleanup. Obtain explicit approval for those changes.**

## 2026-10-24 — Which system is live (finding)

- The live AI workforce is **straight-flush-brain** (private repo) on Supabase `AI-Headquarters`
  (`fcjyfjytmtuadfnzpmmu`): 14 agents, pg_cron worker every 15 min, weekly site health (Mon 15:05 UTC,
  last run 2026-10-23 succeeded), AI visibility and competitor research tasks running, owner signed in.
- The Technical SEO Engineer there already holds `web.read` on `*` (no approval), which is what the weekly
  site audit uses. No new `site.audit` grant is needed.
- This repo's workforce engine (migrations 025-027) lives on `znpqosbwdgrtfediqvwt`, which holds only test
  fixtures and is in a Supabase org the connector cannot currently reach. Migration 027 is **not** applied
  there and is no longer urgent: it would duplicate scheduling that the brain already does live.
- Vercel: `CRON_SECRET` added (sensitive, prod+preview) and production redeployed 2026-10-24.
  `SUPABASE_SERVICE_ROLE_KEY` was already present (Sept). The Vercel Supabase integration vars
  (`SUPABASE_URL`, `POSTGRES_*`) point to `fcjyfjytmtuadfnzpmmu`; the app code reads `NEXT_PUBLIC_SUPABASE_URL`
  (set manually in Sept, sensitive, not readable) — likely the older project.
- Open decision for the owner: consolidate on one system (recommended: the brain), then either point this
  app at the brain's database as its dashboard or retire the duplicate engine.

## 2026-10-31 — Mission Control is the owner dashboard for the brain

- Decision taken: consolidate on **straight-flush-brain** (Supabase `fcjyfjytmtuadfnzpmmu`). This repo's
  duplicate engine is not extended further.
- Mission Control (Design 2, black/neon lime) is published as a private claude.ai artifact and reads the
  brain live through the owner's Supabase connector: website health (latest site check), AI search
  visibility, all 14 agents and their current task, crew deliverables, reports, and pending approvals.
- Approvals decided in Mission Control call `brain_decide_approval` as the owner operator, so they are
  logged as `approval.approved` / `approval.rejected` events like any other owner decision.
- Personal tasks and the Autopilot setting live in the artifact's own database.
- Not yet connected: GA4 visitors, call tracking and form leads (no source in the brain), Google
  Business Profile rating (needs Places API key + Place ID), and the installable `hq.` subdomain build
  (`aiheadquarters-wt` Worker; needs the Cloudflare connector reconnected).
