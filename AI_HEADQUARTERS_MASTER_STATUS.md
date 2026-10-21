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
- **2026-10-21** — independent audit of `main` @ `073939b` (PR #22). Fixed the
  migration set so it reaches a clean fixpoint (migration 016 was producing a
  `budget_reservations` table the application's own RPCs could not use), added
  the first CI that actually runs the test suite, and added a migration
  verification gate. See PR #23. Added the status checklist below.

## Status checklist (VERIFIED / BLOCKED / NOT STARTED)

Status is earned by evidence, never by code existing. "BLOCKED" means the work
is waiting on something only the owner can supply (credentials, a live project,
an approval) — it is not a claim of failure.

| Item | Status | Exact evidence required / held |
|---|---|---|
| Full unit/integration suite on `main` | **VERIFIED** | `npx vitest run` → 280 passed, 15 skipped; `tsc --noEmit` exit 0; `next build` compiled. Now also enforced by CI (PR #23), which passed on the PR. |
| Migration set applies cleanly to a fresh database | **VERIFIED** | `scripts/verify-migrations.sh` against fresh `pgvector/pgvector:pg16` → fixpoint reaches 0 errors; schema-contract asserts pass. Enforced by the `migrations` CI job. |
| Budget reservation lifecycle works from a fresh build | **VERIFIED** | `reserve_budget_idempotent` returns a hold; identical replay returns the same id; `settle_budget_clamped` charges correctly and updates `current_spend`. Reproduced on Postgres 16. |
| PR #20 workforce SQL suites pass on the fixed chain | **VERIFIED** | `workforce_phase_a_test.sql` 84/84 PASS; `workforce_delegation_test.sql` 45/45 PASS (PR #20's 025/026 applied on top). |
| Every open PR classified merge / revise / close | **PARTIAL** | Classification drafted (below); one PR (#23) opened and CI-verified. Owner merge decisions outstanding. |
| Type-check, lint, build enforced on PRs | **VERIFIED** | `.github/workflows/ci.yml` `verify` job green on PR #23. |
| Deployment healthy and authenticated (live) | **BLOCKED** | Needs a successful deployment plus an authenticated smoke test against the live app. No hosting credentials here. |
| Live Supabase auth + RLS against a dedicated test project | **BLOCKED** | Supabase access token unavailable (API returned 401). Needs a dedicated test project and its test-only credentials; `npm run test:live` must pass there, never against production. |
| One real AI request provider → parse → persist → display | **BLOCKED** | Needs one configured provider key. Then: one repeatable query whose parsed output is stored with cost recorded and shown in the dashboard. |
| Scheduled job execution via `/api/jobs/tick` | **BLOCKED** | Needs `CRON_SECRET` in the hosting environment. Then: an authenticated tick that persists, claims, completes, and logs a job. |
| Daily 6:00 AM America/Los_Angeles briefing (live) | **BLOCKED** | Code exists (PR #15). Needs the configured scheduler + `CRON_SECRET`. Then: several consecutive runs, including a daylight-saving transition, and a deliberate failure/retry. |
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

## Pull request classification (audited 2026-10-21)

Every open PR was inspected against its actual diff and, where relevant, tested.
These are recommendations — merges are owner-only and are never performed by an agent.

| PR | Head | Verdict | Reason |
|---|---|---|---|
| #23 | `intelligence-hq/infra-2026-10-21-migration-fixpoint` | **MERGE** | Fixes the migration fixpoint and adds the first real CI. Both CI jobs green. |
| #20 | `phase-a/workforce-core` | **MERGE** | Additive only (no data rewrite). Verified: 309 tests, both SQL suites pass (84/84, 45/45), build OK. Fresh merge-base on `main`. |
| #16 | `vercel/install-and-configure-vercel-w-1hvqjv` | **REVISE** | One-line fix (`@vercel/analytics/react` → `/next`). Confirm it matches the deployed Next version before merging; otherwise harmless but low value. |
| #19 | `intelligence-hq/ai-gateway-provider` | **REVISE** | Adds Vercel AI Gateway as a cost-tracked provider (+379/-19, unit-tested). Keep as a candidate; evaluate cost/benefit against the existing providers before merging (mission P5). |
| #1 | `copilot/implement-sprint-3-1-hardening-pass` | **CLOSE** | Conflicts with `main`; its engine/approval files are already present on `main`, and the sprint 3.1 test + SQL files are absent but superseded by PR #20's coverage. |
| #12 | `copilot/fix-failing-github-actions-job-again` | **CLOSE** | Conflicting; 63 files +8678 lines of stale Phase 5 infra work. Superseded by the current CI on `main`. |
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
