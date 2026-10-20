# AI Headquarters — Master Status & Next Actions

**Last reviewed:** 2026-10-19  
**Repository:** `straightflushplumbing03/AI-Headquarters`  
**Default branch:** `main`  
**Purpose:** This is the plain-English control document for the Straight Flush Plumbing AI Headquarters project. It separates code that exists from capabilities proven to work live.

## Change log

- **2026-10-15** — first version of this document.
- **2026-10-19** — PR #15 merged (`d9c226c`): 6:00 AM Pacific daily gate, daily
  business briefing, operations/handoff and connections docs. PR #18 opened
  (`intelligence-hq/ga4-and-repo-status`): Google Analytics 4 adapter and a
  read-only GitHub repository-status adapter. Both new integrations are
  credential-gated and collect nothing until credentials are supplied.
- **2026-10-20** — Phase A workforce core built on branch `phase-a/workforce-core`
  (local commit, not pushed, not applied to any hosted database). See
  "Phase A workforce core" below.

## Phase A workforce core (2026-10-20)

**State: implemented and tested locally. Not pushed, not migrated, not deployed.**

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
- Hosted Supabase project `AI-Headquarters` (`fcjyfjytmtuadfnzpmmu`) has **no tables and
  no migrations applied**. It is not the database the old handoff notes describe.

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
- Not yet built: a UI for owners to manage policies/delegations, and an agent runner that calls
  justify/review automatically.

Local verification: `DATABASE_URL=postgres://…@localhost/<scratch> scripts/apply-migrations-local.sh`
then `psql <url> -f tests/sql/workforce_phase_a_test.sql`.

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
| P0 | Confirm the hosting deployment is healthy | Handoff notes a previous Vercel deployment problem tied to missing `NEXT_PUBLIC_SUPABASE_*` environment variables; current status must be checked | Successful deployment plus authenticated smoke test |
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
