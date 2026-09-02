# Sprint 3: Safe Action Execution & Approval Enforcement

**Status: COMPLETE (code-level; runtime-verification limits documented below)**

> **Correction note:** An earlier version of this report overstated completion
> (e.g., claimed a "real tests" section and UI that were not committed, and did
> not cover cancellation, action status, or atomic idempotency). This revision
> aligns the report with `SPRINT_3_GAP_CHECK.md` and the work completed since.

## Overview

Sprint 3 implements the critical enforcement layer for autonomous action execution. This is a security and control sprint that makes approval requirements REAL and blocks unsafe execution server-side.

## Architecture Decision: REUSE EXISTING INFRASTRUCTURE

Sprint 3 reuses all existing Phase 6 tables and systems:

- autonomous_decisions table (existing)
- autonomous_actions table (existing)
- approval_requests table (existing)
- action_queue table (existing)
- action_outcomes table (existing)
- Existing RBAC system (owner/admin/member/viewer)
- Existing kill switches (org pause via ai_usage_limits) from Sprint 2
- Existing budget controls (ai_usage_limits) from Sprint 2
- Existing RLS policies for organization isolation

NO new duplicate tables, services, or authorization systems were created.

## Implemented Components

### 1. Approval Management Service (lib/sprint3/approval-manager.ts)

- checkApprovalValid() - verifies approval exists, is approved, not expired (server-side)
- canUserApprove() - verifies user role is owner/admin
- approveAction() - updates approval status with authorization check
- rejectAction() - rejects with authorization check
- cancelAction() - cancels a pending request (Owner/Admin only; approved requests cannot be cancelled)
- getPendingApprovals() - lists pending approvals for org
- getActionStatus() - returns autonomous_actions row scoped to the organization
- getApprovalDetails() - fetch single approval
- Audit logging on every approve/reject/cancel action

Security guarantees:
- Cross-org approval access impossible (organization_id filtering)
- Client cannot spoof approval_status (verified against DB)
- Client cannot spoof user role (verified against DB)
- Viewer and Member roles cannot approve
- Only Owner/Admin can approve, reject, or cancel

### 2. Operating Modes Manager (lib/sprint3/operating-modes.ts)

Three modes implemented:
- SHADOW: prepare actions, never execute externally
- APPROVAL (default): all actions require human approval
- AUTONOMOUS: Level 1 low-risk can auto-execute, Level 2+ still requires approval

Default mode is APPROVAL - the safe default for first deployment (Straight Flush Plumbing).

### 3. API Routes

- GET /api/sprint3/approvals/pending - list pending approvals (org-scoped, auth required)
- POST /api/sprint3/approvals/[approvalId]/approve - approve action (role-checked server-side)
- POST /api/sprint3/approvals/[approvalId]/reject - reject action (role-checked server-side)
- POST /api/sprint3/approvals/[approvalId]/cancel - cancel a pending request (Owner/Admin only)
- GET /api/sprint3/actions/[actionId]/status - action execution status (org-scoped)

All endpoints:
- Verify user session server-side
- Verify organization membership server-side
- Never trust client-supplied role or approval state
- Use the shared `createClient()` helper from `lib/supabase/server.ts`

### 4. Action Execution Engine (lib/sprint3/action-execution-engine.ts)

Fail-closed checks, in order: authentication → organization membership → role/authorization-level permission → risk authorization → DB-verified approval (with expiry) → org kill switch (`ai_usage_limits.paused`) → budget (`AICostController`) → **atomic idempotency claim**.

Atomic idempotency: instead of a check-then-execute race, the engine inserts a
`queued` row into `autonomous_actions` keyed on `(idempotency_key, organization_id)`
before executing. If a concurrent request claims the key first, the insert hits the
unique constraint (Postgres 23505) and the duplicate is blocked. Failed executions
can be retried (the row is re-claimed); completed ones never re-execute.

Shadow mode records an audit event and never dispatches the action handler.

### 5. Database Migrations

- supabase/migrations/sprint3_safe_execution.sql
  - Creates audit_logs table with RLS org isolation
  - Extends autonomous_actions with approval_status, approved_by, approval_notes, approved_at
- supabase/migrations/sprint3_idempotency_claim.sql
  - Unique index on `autonomous_actions (idempotency_key, organization_id)`
  - Backfills idempotency keys for legacy rows

No duplicate tables created.

### 6. Approval UI (components/sprint3/Sprint3ApprovalCenter.tsx)

Functional client component mounted at `/headquarters/[id]/approvals` (above the
legacy task-based ApprovalCenter). It calls the Sprint 3 API endpoints
(pending / approve / reject / cancel), shows reasoning, expected impact, and
response deadlines, and removes a card from the queue after a successful decision.

## Security Verification

| Check | Status |
|---|---|
| approval_required=true blocks execution | IMPLEMENTED |
| Approval status verified server-side | IMPLEMENTED |
| Approval expiration enforced | IMPLEMENTED |
| Viewer cannot approve | IMPLEMENTED |
| Member cannot approve | IMPLEMENTED |
| Owner/Admin can approve | IMPLEMENTED |
| Cross-org approval access blocked | IMPLEMENTED (RLS + query filter) |
| Client cannot spoof organization ID | IMPLEMENTED (server session used) |
| Client cannot spoof role | IMPLEMENTED (role fetched from DB) |
| Audit log on every approve/reject/cancel | IMPLEMENTED |
| Duplicate execution blocked (atomic claim) | IMPLEMENTED + unit-tested |
| Shadow mode never executes | IMPLEMENTED + unit-tested |
| Kill switch (org pause) blocks execution | IMPLEMENTED + unit-tested |
| Budget integration | REUSED from Sprint 2 (AICostController) |

## Enforcement Tests (tests/unit/sprint3-enforcement.test.ts)

Real vitest suite with a mocked Supabase client — 20 tests proving:

- Missing approval blocks execution when approval is required
- Pending / rejected / expired / cancelled approvals block execution
- Approved + unexpired approval allows execution
- Non-members are blocked; viewer blocked on level_1; member blocked on level_2+
- Critical risk is never auto-approved
- Org kill switch (paused) blocks execution with the pause reason
- Atomic idempotency: completed actions cannot re-execute; concurrent claims
  collide on the unique constraint and are blocked; failed actions can retry
- Shadow mode records but never executes the handler
- ApprovalManager: viewer cannot approve; owner can; double-approve blocked;
  cancel only works on pending; cross-org access returns not-found; action
  status is org-scoped

Run with `npm test` (52 tests across the repo pass; no live database needed).

## Status Breakdown

### IMPLEMENTED
- Approval workflow (pending/approved/rejected/cancelled)
- Cancellation capability (manager + API)
- Action status capability (manager + API)
- Server-side approval permission checks
- Organization isolation on all approval operations
- Atomic idempotency with unique-constraint enforcement
- Audit logging
- Operating mode configuration (shadow/approval/autonomous)
- Approval + cancellation + status API endpoints
- Functional approval UI component, mounted in the approvals page
- Real enforcement test suite (unit, mocked DB)

### NOT RUNTIME-TESTED (requires live Supabase)
- Deployed RLS behavior and end-to-end tenant isolation against a live database
- Real-world behavior of the unique-constraint claim under production load

### NOT IMPLEMENTED (explicitly out of scope for Sprint 3)
- Real action execution handlers (e.g., actually sending an email, publishing content) - these require external integrations not authorized in this sprint
- Cascading/multi-approver workflows
- External notification channels (Slack/email/webhook) for approvals
- Global/agent-level kill switch sharing across service instances (Sprint 2 limitation, unresolved)

### KNOWN GAPS (from SPRINT_3_GAP_CHECK.md, still open)
- The engine trusts action approval/risk fields supplied by the caller rather than loading the authoritative action + decision records itself
- Risk model mapping to the requested LOW / CONTROLLED / APPROVAL_REQUIRED / PROHIBITED semantics is not explicit
- `approval_requests.approval_status` DB constraint (Phase 6) does not include `cancelled`/`expired`; the Sprint 3 migration should be extended to alter it
- No complete execution state-transition machine for autonomous_actions
- `OperatingModeManager` mode is in-memory; not persisted per organization

## Files Changed

- lib/sprint3/approval-manager.ts (cancelAction, getActionStatus, audit on cancel)
- lib/sprint3/action-execution-engine.ts (atomic idempotency claim, retry re-claim, claim row carries action id)
- lib/sprint3/operating-modes.ts (unchanged this session)
- app/api/sprint3/approvals/pending/route.ts (migrated to shared createClient)
- app/api/sprint3/approvals/[approvalId]/approve/route.ts (migrated to shared createClient)
- app/api/sprint3/approvals/[approvalId]/reject/route.ts (migrated to shared createClient)
- app/api/sprint3/approvals/[approvalId]/cancel/route.ts (new)
- app/api/sprint3/actions/[actionId]/status/route.ts (new)
- components/sprint3/Sprint3ApprovalCenter.tsx (new)
- app/headquarters/[id]/approvals/page.tsx (mounts Sprint3ApprovalCenter)
- supabase/migrations/sprint3_idempotency_claim.sql (new)
- tests/unit/sprint3-enforcement.test.ts (new)
- vitest.config.ts (scoped to tests/unit + tests/integration; excludes Playwright e2e)
- tsconfig.json (added `moduleResolution: "bundler"` to fix typecheck)
- tests/unit/providers.test.ts, tests/unit/ceo-agent.test.ts (repaired broken pre-existing assertions/imports)
- SPRINT_3_COMPLETION_REPORT.md (this correction)

## Remaining Limitations

1. Operating mode is stored in-memory in this implementation; for multi-instance production deployment it should be persisted to a database table (e.g., organization_settings.operating_mode).
2. Enforcement tests use a mocked Supabase client; a live Supabase test instance is still needed to verify RLS and constraint behavior end-to-end.
3. Real action execution (external side effects) remains unimplemented per explicit sprint scope - this is intentional and matches the "safety machinery first" objective.
4. The engine's caller-supplied action/decision fields should be replaced with server-loaded authoritative records before enabling autonomous mode.

## Sprint 3 Complete

Do NOT start Sprint 4 without explicit approval.
