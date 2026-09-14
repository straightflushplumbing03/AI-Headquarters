# Business Brain — Financial Lifecycle & State Machine

This document is the authoritative reference for how money moves through
Business Brain. It covers the reserve → execute → settle/release pipeline,
every crash-recovery point, the idempotency model, and what operators can
observe.

Everything here describes code that exists and is tested (unit 109 + live
smoke/concurrency against a dedicated fixture org). It does not describe
aspirational behavior.

---

## 1. The core invariant

> **A cost is never charged unless it was first atomically reserved; a hold
> is never left stranded.**

Two enforcement layers implement this:

1. **Database (always authoritative, never bypassed):**
   - `reserve_budget_idempotent(...)` — takes a per-org row lock
     (`FOR UPDATE`), computes `remaining = monthly_budget − current_spend −
     SUM(open holds)`, raises `BUDGET_EXCEEDED` if the request exceeds it,
     and inserts a `budget_reservations` row. Uses
     `(organization_id, action_idempotency_key)` exactly-once: re-reserving
     the same action returns the existing hold.
   - `settle_budget_clamped(...)` — charges `LEAST(actual, reserved)`,
     idempotent (only `status='reserved'` rows settle; a second call is a
     no-op returning false).
   - `release_budget(...)` — failure path, idempotent, only `'reserved'` rows.
   - `release_stale_budget_reservations(...)` — reaper: releases holds older
     than an age window (safety net for a crashed process between reserve and
     settle/release).

2. **Application (works with, never around, the DB):**
   - `lib/ai/execution-service.ts` (legacy authenticated `/api/ai/execute`)
   - `lib/sprint3/budget-reservation.ts` (service wrapping the RPCs)
   - `lib/sprint3/action-execution-engine.ts` (background action executor
     with full fail-closed safety gates)

## 2. State models

### budget_reservations

| Column | Meaning |
|---|---|
| `id` | reservation id (uuid) |
| `organization_id` | tenant — budget is always org-scoped |
| `reserved_amount` | hold taken at reserve time |
| `settled_amount` | actual charged (≤ reserved) |
| `status` | `reserved` → `settled` \| `released` |
| `action_idempotency_key` | exactly-once arbiter per action |

Precision: `reserved_amount`/`settled_amount` are `NUMERIC(12,2)` on the
current live schema. Migration `020_sprint53_budget_precision.sql` widens
them to `NUMERIC(12,6)` so micro-costs like `0.1234` are held **exactly**
instead of under-reserving to `0.12`. This is additive and safe (no data
loss); apply it on the next `supabase db push`.

### ai_usage_limits

| Column | Meaning |
|---|---|
| `monthly_budget` | hard ceiling (`NUMERIC(10,2)`) |
| `current_spend` | sum of settled charges (`NUMERIC(10,6)`) |
| `reserved_amount` | hold watermark for open reservations |
| `paused` / `pause_reason` | org kill switch |

## 3. Execution pipeline and crash points

Pipeline (both the legacy path and the background engine):

```
AUTH → ORG SCOPE → PROVIDER → ESTIMATE
  → RESERVE (atomic, idempotent)          [crash point A]
  → EXECUTE                                [crash points B, C]
  → SETTLE (clamped, idempotent) OR RELEASE  [crash points D, E]
  → PERSIST EXECUTION LOG                   [crash point F]
```

| # | Crash point | Recovery mechanism | Idempotency |
|---|---|---|---|
| A | After reserve, before execute | Hold exists; stale-hold reaper releases after age window if never settled/released. Re-executing the same `action_idempotency_key` reuses the same hold (no double-reserve). | ✅ |
| B | During execute (provider throw) | Application releases the hold on the exception path. | ✅ |
| C | After provider returns, before settle | Hold still `reserved`; a retry of the same key reuses it and settles exactly once. | ✅ |
| D | During settle (RPC error) | Settle is idempotent (`settle_budget_clamped` returns false for already-settled). Reaper covers a crash between reserve and settle. | ✅ |
| E | During execution-log insert | Settle already succeeded (spend booked); a failed log insert is logged, not fatal — the ledger is authoritative. | ✅ |
| F | Crash before any journal write | Nothing reserved → nothing charged. | ✅ |

No path writes `current_spend` directly from the client. Only
`settle_budget_clamped` books spend, and it clamps to the hold — a caller
can never inflate available budget by settling more than it reserved.

## 4. Idempotency keys

- The legacy path uses `actionIdempotencyKey = "exec:" + taskId`.
- The background engine uses the action's `idempotencyKey`.
- `reserve_budget_idempotent` enforces exactly-once via the partial unique
  index `budget_reservations_open_per_action_unique`
  (`(organization_id, action_idempotency_key)` where `status='reserved'`).
- `settle_budget_clamped` / `release_budget` are idempotent by only
  affecting `state='reserved'` rows.

## 5. Concurrency

- All reservations serialize per-org on `ai_usage_limits` row (FOR UPDATE).
- Two concurrent reserves for `$8` against a `$10` budget: exactly one wins
  with `BUDGET_EXCEEDED` for the other. **Verified live** in
  `tests/integration/business-brain-concurrency-live.test.ts` against a
  dedicated fixture org.
- Org budgets can never overspend: the sum of open holds plus spend is
  bounded by `monthly_budget` at every instant.

## 6. Approval → execution

Approvals are persisted in `approval_requests`. An approved action enqueues
a durable `execute_autonomous_action` background job; the engine re-validates
every fail-closed gate (membership, permission, risk, approval status,
kill switches, budget) before executing — an approval alone is not
sufficient. Pending approvals past `response_deadline` are expired by
`expire_approvals(interval)` / `expire_stale_approvals()` / the
`approval_expiration_sweep` job; an expired approval blocks execution.

## 7. Observability

Every financial operation emits one structured JSON line with
`"event":"financial"` plus trace ids (`organizationId`, `requestId`,
`reservationId`, `executionId`, `settlementId`, `actionId`, `taskId`) and a
canonical `op` from:

`budget.reserve.{start,success,rejected,error}` ·
`budget.settle.{start,success,noop,error}` ·
`budget.release.{start,success,noop,error}` ·
`execution.{start,reserved,success,failure,log.persisted}` ·
`approval.expired`

Implementation: `lib/ai/financial-logger.ts`. It never logs API keys,
service-role keys, prompts, or customer content.

## 8. Running the verification

```bash
# Unit (109)
npx vitest run tests/unit

# Live smoke + concurrency (dedicated fixture org — safe, no prod data)
set -a && source .env.local && set +a
BUSINESS_BRAIN_SMOKE_FAKE_PROVIDER=1 NODE_ENV=test \
  npx vitest run tests/integration/business-brain-smoke.test.ts \
                 tests/integration/business-brain-concurrency-live.test.ts

# The suites clean up every fixture row (organizations, agents, tasks,
# ai_usage_limits, budget_reservations, ai_execution_logs, audit_logs,
# activity_events) in afterAll. Verify zero residue with a direct DB query.
```

## 9. Known limitation

The current `budget_reservations` columns are `NUMERIC(12,2)`. Until
migration `020` is pushed, micro-costs (e.g. `0.1234`) are rounded to
`0.12` when the hold is written — settlement is then clamped to the rounded
hold, so the org is *under*-charged by the rounded fraction. This is safe
(never over-charges, never unlocks a budget hole) and is fixed by the
migration.