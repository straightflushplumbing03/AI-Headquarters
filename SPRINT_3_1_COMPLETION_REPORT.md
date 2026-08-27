# Sprint 3.1 Hardening Pass — Completion Report

## Overview

This is a focused security/enforcement hardening pass that closes all MISSING and PARTIALLY
IMPLEMENTED gaps identified in `SPRINT_3_GAP_CHECK.md`. It does **not** start Sprint 4,
add external integrations, call real AI providers, or create duplicate architecture.

---

## Categories

### IMPLEMENTED

#### 1. Authoritative Server-Side Execution (`lib/sprint3/action-execution-engine.ts`)

**Original gap:** Engine trusted client-supplied `organizationId`, `riskLevel`,
`authorizationLevel`, `approvalRequired`, `decisionId` context, and `operatingMode`.

**Fix:** `executeAction(actionId, userId)` — only `actionId` and `userId` (from authenticated
session) are accepted from the caller. All authoritative data is loaded server-side:
- Action record loaded by `actionId` only; `organizationId` comes from the action record
- Decision loaded by `decisionId` from action + org isolation
- Risk level and authorization level come from the DB action record
- Approval status loaded from DB approval_requests record
- Operating mode loaded from DB `ai_usage_limits.approval_level`
- Cross-tenant access fails closed (membership check against DB-loaded org)

#### 2. Protected Execution Pipeline

**Original gap:** Approval, kill-switch, budget, and idempotency were partially or unreliably
enforced. Operating mode not loaded from persistent source.

**Fix:** Pipeline order enforced:
```
authentication → org membership (DB) → authoritative action load →
authoritative decision load → risk mapping → kill switches (persistent DB) →
operating mode (persistent DB) → approval → authorization →
budget → atomic idempotency claim → execute internal handler → record result → audit
```

Fail-closed: any failure returns `{ success: false }`.

Risk mapping (using actual Phase 6 schema values):
| DB value | Semantic | Level |
|----------|----------|-------|
| `low` | LOW | level_1, autonomous |
| `medium` | CONTROLLED | level_2, controlled |
| `high` | APPROVAL_REQUIRED | level_3, approval_required |
| `critical` | PROHIBITED | level_4, never autonomous |

#### 3. Cancellation

**Original gap:** No cancellation capability in `ApprovalManager` or API routes.

**Fix:**
- `ApprovalManager.cancelAction()` added — authenticates user, verifies org membership,
  checks role (owner/admin only), validates cancellable state (only `pending`), blocks
  already-approved/rejected/cancelled/expired approvals from cancellation, also cancels
  linked queued/scheduled action
- Audit event written for cancellation
- `app/api/sprint3/approvals/[approvalId]/cancel/route.ts` — POST endpoint with server-side
  auth, org membership check, and ApprovalManager delegation

#### 4. Action Status API

**Original gap:** No action-status endpoint existed.

**Fix:** `app/api/sprint3/actions/[actionId]/status/route.ts` — GET endpoint:
- Verifies authentication via `supabase.auth.getUser()`
- Verifies org membership against `organization_members`
- Loads action only from the authenticated user's organization (tenant isolation)
- Returns only safe fields: `id`, `executionStatus`, `riskLevel`, `authorizationLevel`,
  `approvalStatus`, `startedAt`, `completedAt`, `createdAt`, `resultSummary`, `succeeded`
- Does not expose payload, internal data, or error details

#### 5. Functional Approval UI (`components/headquarters/ApprovalCenter.tsx`)

**Original gap:** Existing component queried `tasks` table with no Sprint 3 integration.

**Fix:** Rewritten to:
- Load pending approvals from `/api/sprint3/approvals/pending` (server-side enforcement)
- Display: title, description, reason, expected impact, risk, estimated cost, agent,
  created time, expiration, status
- Buttons: Approve, Reject, Cancel (all call Sprint 3 API endpoints)
- Shows role-based hint when user cannot act
- Expired approvals shown with visual indicator; action buttons hidden for expired

#### 6. Kill Switches — Persistent and Ordered

**Original gap:** Only checked `ai_usage_limits.paused` (org stop); no reliable global or
agent kill-switch check. Relied on process-local in-memory state.

**Fix:** `checkKillSwitchesPersistent()` checks DB-backed state:
1. Global stop: `ai_usage_limits.paused` (AICostController sets all rows when global stop enabled)
2. Org stop: same `ai_usage_limits.paused` for the specific org
3. Agent stop: `agents.active = false`
Kill switches checked **before** operating mode so a kill switch always produces a hard block,
not a silent shadow mode. Fails closed on DB error.

#### 7. Budget — Real Agent ID

**Original gap:** Budget check used synthetic `'action-engine'` agent id.

**Fix:** Uses `action.executed_by_agent_id ?? action.id` — the real agent from the DB action
record. `AICostController.checkBudget` reused unchanged.

#### 8. Atomic Idempotency

**Original gap:** Check-then-act (not atomic); concurrent requests could both pass.

**Fix:** `atomicClaim()` uses a conditional UPDATE:
```sql
UPDATE autonomous_actions
SET execution_status = 'executing'
WHERE id = $actionId AND execution_status IN ('queued', 'scheduled')
```
Only one concurrent request can win the conditional UPDATE. The second gets no rows updated
and is blocked with an appropriate reason (already executing, completed, cancelled, etc.).

#### 9. Operating Mode — Persistent

**Original gap:** `OperatingModeManager` used in-memory `Map` (process-local).

**Fix:** `getModePersistent(orgId)` loads `ai_usage_limits.approval_level` from DB.
Mapping: `'autonomous'` → autonomous; all others → approval (safe default).
Falls back to `'approval'` on DB error (fail-closed).
`paused` state is now handled exclusively by kill-switch check (not mode).

#### 10. Approval Status Schema (`supabase/migrations/sprint3_1_hardening.sql`)

**Original gap:** `approval_requests.approval_status` constraint only had `pending/approved/
rejected/modified/deferred`; `cancelled` and `expired` unsupported.

**Fix:** Idempotent migration that:
- Drops old constraint if present
- Adds updated constraint: `pending, approved, rejected, modified, deferred, cancelled, expired`
- Also ensures `audit_logs` table, RLS policy, indexes for idempotency and approval lookups

#### 11. `ApprovalManager` — Cancellation Audit

**Fix:** `logApprovalAction` signature updated to accept `'cancelled'` in addition to
`'approved'`/`'rejected'`. Audit event `approval_cancelled` written on successful cancellation.

---

### VERIFIED BY TEST

All 37 Sprint 3.1 tests pass. Test file: `tests/unit/sprint3-1.test.ts`

```
✓ tests/unit/sprint3-1.test.ts  (37 tests) 19ms
Test Files  1 passed (1)
Tests  37 passed (37)
```

Tests cover:

**Approval:**
- ✅ Missing approval blocks execution
- ✅ Pending approval blocks execution
- ✅ Rejected approval blocks execution
- ✅ Expired approval blocks execution
- ✅ Valid approved action executes

**Authorization:**
- ✅ Viewer cannot execute level_2 action
- ✅ Cross-tenant user (not in org) denied
- ✅ Unauthorized user (missing userId) denied

**Kill Switches:**
- ✅ Org kill switch (paused=true) blocks execution
- ✅ Agent kill switch (active=false) blocks execution

**Budget:**
- ✅ Budget exceeded blocks execution
- ✅ Real agent id used (not synthetic 'action-engine')

**Idempotency:**
- ✅ Duplicate execution (already completed) blocked via atomicClaim stub

**Modes:**
- ✅ Shadow mode returns success without invoking handler
- ✅ Autonomous permits level_1/low without approval
- ✅ Autonomous requires approval for level_2+
- ✅ Autonomous blocks high risk
- ✅ Approval mode always requires approval
- ✅ Shadow mode always requires approval (blocks handler)
- ✅ Critical (PROHIBITED) risk always blocked

**Client spoofing:**
- ✅ Client-supplied org ignored — loaded from action record
- ✅ Client-supplied risk ignored — uses DB risk level

**State machine:**
- ✅ Invalid transition (cancelled → executing) rejected

**ApprovalManager:**
- ✅ Viewer cannot approve
- ✅ Member cannot approve
- ✅ Admin can approve
- ✅ Non-pending approval cannot be re-approved
- ✅ Pending approval can be cancelled
- ✅ Already-approved approval cannot be cancelled
- ✅ Rejected approval cannot be cancelled
- ✅ Viewer cannot cancel
- ✅ Cross-tenant member cannot cancel

**OperatingModeManager:**
- ✅ Falls back to approval mode when no Supabase
- ✅ Paused org → kill switch blocks (not mode)
- ✅ approval_level=autonomous → autonomous
- ✅ approval_level=controlled → approval
- ✅ DB error → fails closed (approval mode)

---

### STATICALLY VERIFIED

- **No client-supplied org trusted:** `ActionExecutionEngine` signature only accepts
  `actionId` and `userId`; `organizationId` always from DB action record.
- **No client-supplied risk/approval trusted:** All loaded from DB.
- **Cross-tenant isolation:** Org membership verified against DB before any action is taken.
  Action loaded with `id` only, `organization_id` comes from DB record.
- **Kill switches before mode:** Kill switch check happens before operating mode evaluation,
  ensuring a paused/stopped org always blocks with an explicit error.
- **No synthetic agent id:** Budget check uses `action.executed_by_agent_id ?? action.id`.
- **Audit writes fail-safe:** `audit()` catches errors to ensure audit failure cannot create
  a safety bypass.
- **Atomic idempotency via conditional UPDATE:** No distributed infrastructure required.
- **Internal handlers only:** `performAction` uses a typed map of internal mock handlers;
  no real external/AI calls possible.
- **Cancellation permission enforced server-side:** Only owner/admin, only pending status.
- **Status endpoint tenant isolation:** Action loaded with `organization_id` filter.

---

### NOT RUNTIME VERIFIED

- **RLS Policies:** Row-level security policies exist in migrations and are statically correct,
  but no Supabase instance was available during this implementation.
  **CODE VERIFIED — RUNTIME RLS TEST NOT EXECUTED**
- **DB constraint migration:** `sprint3_1_hardening.sql` is syntactically correct and
  idempotent, but not applied to a live Supabase instance.
- **Concurrent idempotency under real DB:** The atomic claim relies on database-level
  conditional UPDATE uniqueness. This is correct in PostgreSQL but was not tested with
  a real concurrent load.

---

### NOT IMPLEMENTED

- **Rate limiting:** No rate-limit check is performed (no existing rate-limit table/service
  was discovered in the codebase).
- **Approval expiration background job:** Approvals with past `response_deadline` are
  checked at execution time but no background job marks them `expired` proactively.
- **Real Phase6Orchestrator integration:** The `Phase6Orchestrator` still inserts actions
  as completed directly; Sprint 3.1 engine is the protected execution path but
  Phase6Orchestrator was not refactored (per requirement: do not rebuild unrelated code).

---

## Files Changed

| File | Change |
|------|--------|
| `lib/sprint3/action-execution-engine.ts` | Full rewrite — authoritative server-side pipeline |
| `lib/sprint3/approval-manager.ts` | Added `cancelAction()`, updated `logApprovalAction` signature |
| `lib/sprint3/operating-modes.ts` | Added `OperatingModeManager` with persistent DB mode, risk mapping docs |
| `app/api/sprint3/approvals/[approvalId]/cancel/route.ts` | New — cancellation API |
| `app/api/sprint3/actions/[actionId]/status/route.ts` | New — action status API |
| `components/headquarters/ApprovalCenter.tsx` | Rewritten — Sprint 3 API integration, cancel button |
| `supabase/migrations/sprint3_1_hardening.sql` | New — idempotent constraint + index migration |
| `tests/unit/sprint3-1.test.ts` | New — 37 focused Vitest tests |
| `vitest.config.ts` | New — vitest alias configuration |

---

## API Changes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/sprint3/approvals/pending?organizationId=X` | List pending approvals |
| POST | `/api/sprint3/approvals/:id/approve` | Approve (owner/admin only) |
| POST | `/api/sprint3/approvals/:id/reject` | Reject (owner/admin only) |
| POST | `/api/sprint3/approvals/:id/cancel` | Cancel (owner/admin only) — **NEW** |
| GET | `/api/sprint3/actions/:id/status?organizationId=X` | Action status — **NEW** |

---

## Security Changes

1. Engine no longer accepts any authorization-sensitive fields from caller
2. Kill switches checked before operating mode (hard block vs. silent shadow)
3. Atomic conditional UPDATE prevents race condition in duplicate execution
4. Budget check uses real agent id (not synthetic)
5. Status endpoint returns only safe summary fields, no payload/internal data
6. Cancellation permission enforced server-side (owner/admin only, pending state only)
7. All DB queries include `organization_id` filter for tenant isolation

---

## Remaining Limitations

- No real AI/external integration tests possible without external services
- RLS runtime verification requires live Supabase instance
- No background job for proactive approval expiration
- `Phase6Orchestrator` direct-completion path not protected by Sprint 3.1 engine
  (would require Sprint 4 scope)
- Not production-ready: requires Supabase deployment, DB migration execution,
  and end-to-end verification before production use

---

*Generated: Sprint 3.1 Hardening Pass — Do not start Sprint 4*
