# AI Headquarters — Master Status & Next Actions

**Last reviewed:** 2026-10-15  
**Repository:** `straightflushplumbing03/AI-Headquarters`  
**Default branch:** `main`  
**Purpose:** This is the plain-English control document for the Straight Flush Plumbing AI Headquarters project. It separates code that exists from capabilities proven to work live.

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
- A daily briefing / 6:00 AM Pacific cadence implementation is proposed in PR #15; it is **not considered active in production until merged, deployed, configured, and tested**.

## Current blockers and dependencies

| Priority | Item | Known status | What proves completion |
|---|---|---|---|
| P0 | Establish one trusted project status and backlog | This document is the proposed starting point; merge it after review | This file is merged and referenced by the README / handoff |
| P0 | Review open pull requests and stale Copilot work | Open PRs include #15 and older WIP Copilot PRs (#2, #4, #5, #6, #7); PR #16 also needs current-state review | Every PR is marked merge, revise, or close with a reason; no PR is merged just to tidy the list |
| P0 | Confirm the hosting deployment is healthy | Handoff notes a previous Vercel deployment problem tied to missing `NEXT_PUBLIC_SUPABASE_*` environment variables; current status must be checked | Successful deployment plus authenticated smoke test |
| P0 | Verify database migrations and tenant isolation on a dedicated test database | Live hosted Supabase verification was previously blocked / unverified | `npm run test:live` and RLS probes pass against a separate test project, never production |
| P0 | Run a real AI request through provider → parser → persisted result | No provider key / real parsed response was recorded in the handoff at the time of the audit | One successful, repeatable test query with output stored and errors handled |
| P0 | Configure scheduled job execution | `/api/jobs/tick` requires `CRON_SECRET`; current deployment configuration must be verified | Authenticated cron tick succeeds; job is persisted, claimed, completed, and visible in logs |
| P1 | Connect Google Search Console and Google Business Profile | Code is described as implemented but credential-gated in PR #15 | OAuth configured securely and one real read-only request succeeds for each service |
| P1 | Implement GA4 connection | PR #15 describes GA4 as not built | Integration has tests and returns actual GA4 data |
| P1 | Add GitHub CI/deployment status integration | PR #15 describes this as not built; handoff says no project-owned `.github/workflows` existed at audit time | CI runs on pull requests and reports status; deployment status is observable |
| P1 | Verify the daily briefing at 6:00 AM America/Los_Angeles | Code exists in PR #15; deployment and configuration not confirmed | Several successful runs, including daylight-saving-safe schedule behavior |
| P1 | Separate AI-search checks from estimates/proxies | AI visibility should not be reported as measured unless actual queries were run | Reports label source, date, query, response, and confidence; unavailable sources remain unavailable |
| P1 | Establish approved website-change workflow | Intended loop is monitor → recommend → approve → implement → measure → learn | Proposed changes use a separate branch/PR, checks pass, owner approves, then deployment is verified |
| P2 | Measure business outcomes | Requires analytics / call / lead data | Monthly baseline and tracked changes for search visibility, qualified calls, leads, and booked work |

## Pull request cleanup procedure

Review each PR's current status and diff before deciding. Do not close or merge solely based on age.

1. **PR #15 — daily automation + connection checklist:** inspect the latest diff and checks. If sound, confirm required secrets and migration behavior, then merge only with owner authorization and deploy separately.
2. **PR #16 — Vercel Web Analytics:** verify whether it is still open, inspect its diff and checks, and merge only if it is still needed and compatible with the actual hosting setup.
3. **PRs #2, #4, #5, #6, #7 — WIP Copilot requests:** inspect whether they contain useful unique fixes or are stale duplicates. Close only after checking their diffs and related commits.
4. Re-run the test suite after any merge. Never infer production health from a green unit-test run alone.

## Required owner-provided setup (never commit secret values)

- Dedicated Supabase test project and its test-only credentials in the secure execution environment.
- One AI provider API key, securely configured, to run a real request.
- `CRON_SECRET` configured in the actual hosting project's environment.
- Google OAuth access/refresh tokens for Search Console and Business Profile, where required.
- Access to the hosting dashboard to verify deployments and environment-variable names.
- Confirm the intended hosting and billing plan before enabling minute-level cron.

**Security:** never paste secret values into GitHub issues, commits, pull requests, or this status document. Use the hosting provider's encrypted environment settings or the approved secret manager.

## Safe execution order

### Milestone 1 — Repository organization
- [ ] Review current default-branch state and all open PRs.
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
- [ ] Establish a baseline from Search Console, GBP, GA4, and website technical checks.
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
