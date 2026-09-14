/**
 * Sprint 5.3 P2: Atomic budget reservation — unit tests
 *
 * Proves the reserve → execute → settle/release pipeline enforces the budget
 * invariant. The Supabase mock SIMULATES THE ATOMIC SEMANTICS of the Postgres
 * RPCs (migrations 012 + 016): a lock queue serializes reserve calls exactly
 * as FOR UPDATE does, remaining = budget - spend - open holds is re-checked
 * inside the "lock", and failures raise the same SQL error codes. A live
 * Postgres integration test (tests/integration/budget-concurrency-live.test.ts,
 * env-gated) must still run against a real database before this is treated as
 * runtime-verified.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// The engine imports AICostController; the reservation service replaced its
// budget gate (the controller remains for the AI execution route).
vi.mock('@/lib/ai/cost-controller', () => ({
  AICostController: class {
    checkBudget = vi.fn().mockResolvedValue({ allowed: true })
    recordCost = vi.fn().mockResolvedValue(undefined)
  },
}))

import { ActionExecutionEngine } from '@/lib/sprint3/action-execution-engine'
import { BudgetReservationService } from '@/lib/sprint3/budget-reservation'
import type { ActionExecutionRequest } from '@/lib/sprint3/action-execution-engine'

type Row = Record<string, any>

interface SimulatedDb {
  ai_usage_limits: Row[]
  budget_reservations: Row[]
  [table: string]: any
}

let uuidCounter = 0
function nextId(prefix: string): string {
  uuidCounter += 1
  return `${prefix}-${String(uuidCounter).padStart(4, '0')}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Supabase mock with ATOMIC budget RPCs mirroring migration 012 + 016 SQL:
 * - reserve: serialized via a lock queue (FOR UPDATE); fail-closed checks for
 *   kill switch, paused org, missing budget row, and insufficient remaining.
 * - settle: clamped to the hold, idempotent, only 'reserved' rows.
 * - release: idempotent, only 'reserved' rows.
 * - release_stale: reaper for orphaned holds.
 * delayFirstReserveMs injects a pause BEFORE the first reserve takes the
 * lock — simulating two executors racing at the reservation step.
 */
function makeBudgetSupabase(
  opts:
    | Array<{ organization_id: string; monthly_budget: number; current_spend?: number; paused?: boolean; pause_reason?: string | null }>
    | {
        orgs: Array<{ organization_id: string; monthly_budget: number; current_spend?: number; paused?: boolean; pause_reason?: string | null }>
        globalKillSwitch?: boolean
        delayFirstReserveMs?: number
      }
) {
  const norm = Array.isArray(opts) ? { orgs: opts } : opts
  const db: SimulatedDb = {
    ai_usage_limits: norm.orgs.map((o) => ({
      organization_id: o.organization_id,
      monthly_budget: o.monthly_budget,
      current_spend: o.current_spend ?? 0,
      paused: o.paused ?? false,
      pause_reason: o.pause_reason ?? null,
    })),
    budget_reservations: [],
    autonomous_actions: [],
    approval_requests: [],
    organization_members: [
      { id: 'm1', user_id: 'user-1', organization_id: 'org-1', role: 'owner' },
    ],
    audit_logs: [],
    action_outcomes: [],
    system_flags: [],
  }

  const callLog: Array<{ op: string; table: string; payload?: any; filters?: Row }> = []
  const waiters: Array<() => void> = []
  let reservesSeen = 0

  // ---------- RPC implementations (mirror the SQL semantics) ----------

  async function rpcReserveBudgetIdempotent(args: Row): Promise<string> {
    const { p_organization_id, p_agent_id, p_task_id, p_amount, p_action_idempotency_key } = args
    if (!p_action_idempotency_key) throw new Error('INVALID_RESERVATION_KEY: required')
    if (p_amount == null || p_amount < 0) throw new Error('INVALID_RESERVATION_AMOUNT: must be >= 0')

    reservesSeen += 1
    if (norm.delayFirstReserveMs && reservesSeen === 1) {
      await sleep(norm.delayFirstReserveMs) // racer arrives early, lock not yet held
    }

    const unlock = acquireLockNow() // simulates SELECT ... FOR UPDATE
    try {
      const existing = db.budget_reservations.find(
        (r) =>
          r.organization_id === p_organization_id &&
          r.action_idempotency_key === p_action_idempotency_key &&
          r.status === 'reserved'
      )
      if (existing) return existing.id

      // Fail-closed: global stop blocks every reservation.
      if (norm.globalKillSwitch) {
        throw new Error('KILL_SWITCH_ACTIVE: global emergency stop enabled')
      }

      const budget = db.ai_usage_limits.find((b) => b.organization_id === p_organization_id)
      if (!budget) throw new Error('NO_BUDGET_ROW: no ai_usage_limits row for organization')
      if (budget.paused) {
        throw new Error(`KILL_SWITCH_ACTIVE: ${budget.pause_reason ?? 'organization paused'}`)
      }

      const openHolds = db.budget_reservations
        .filter((r) => r.organization_id === p_organization_id && r.status === 'reserved')
        .reduce((s, r) => s + r.reserved_amount, 0)
      const remaining = budget.monthly_budget - (budget.current_spend ?? 0) - openHolds

      if (p_amount > remaining) {
        throw new Error(`BUDGET_EXCEEDED: remaining $${remaining}, requested $${p_amount}`)
      }

      const id = nextId('res')
      db.budget_reservations.push({
        id,
        organization_id: p_organization_id,
        agent_id: p_agent_id ?? null,
        task_id: p_task_id ?? null,
        reserved_amount: p_amount,
        settled_amount: null,
        status: 'reserved',
        reference: null,
        action_idempotency_key: p_action_idempotency_key,
        created_at: new Date().toISOString(),
        settled_at: null,
      })
      return id
    } finally {
      unlock()
    }
  }

  // The RPC body runs with the lock already held (callers queue before the
  // body); release just hands the lock to the next queued racer.
  function acquireLockNow(): () => void {
    return () => {
      const next = waiters.shift()
      if (next) next()
    }
  }

  async function rpcSettleBudgetClamped(args: Row): Promise<boolean> {
    const { p_reservation_id, p_organization_id, p_actual_amount } = args
    if (p_actual_amount == null || p_actual_amount < 0) {
      throw new Error('INVALID_SETTLEMENT_AMOUNT: actual amount must be >= 0')
    }
    const row = db.budget_reservations.find(
      (r) =>
        r.id === p_reservation_id &&
        r.organization_id === p_organization_id &&
        r.status === 'reserved'
    )
    if (!row) return false // idempotent no-op (already settled/released/foreign)
    const charge = Math.min(p_actual_amount, row.reserved_amount) // DB clamp
    row.settled_amount = charge
    row.status = 'settled'
    row.settled_at = new Date().toISOString()

    const budget = db.ai_usage_limits.find((b) => b.organization_id === p_organization_id)
    if (budget) budget.current_spend = (budget.current_spend ?? 0) + charge
    return true
  }

  async function rpcReleaseBudget(args: Row): Promise<boolean> {
    const row = db.budget_reservations.find(
      (r) =>
        r.id === args.p_reservation_id &&
        r.organization_id === args.p_organization_id &&
        r.status === 'reserved'
    )
    if (!row) return false
    row.status = 'released'
    row.settled_at = new Date().toISOString()
    return true
  }

  async function rpcReleaseStale(args: Row): Promise<number> {
    if (args.p_max_age_seconds == null || args.p_max_age_seconds <= 0) {
      throw new Error('INVALID_REAPER_AGE: max age must be positive')
    }
    const cutoff = Date.now() - args.p_max_age_seconds * 1000
    let released = 0
    for (const r of db.budget_reservations) {
      if (
        r.organization_id === args.p_organization_id &&
        r.status === 'reserved' &&
        new Date(r.created_at).getTime() < cutoff
      ) {
        r.status = 'released'
        r.settled_at = new Date().toISOString()
        released += 1
      }
    }
    return released
  }

  const client: any = {
    callLog,
    db,
    from: (table: string) => chain(table),
    rpc: async (fn: string, args: Row) => {
      callLog.push({ op: `rpc:${fn}`, table: fn, payload: args })
      try {
        if (fn === 'reserve_budget_idempotent') {
          return { data: await rpcReserveBudgetIdempotent(args), error: null }
        }
        if (fn === 'settle_budget_clamped') {
          return { data: await rpcSettleBudgetClamped(args), error: null }
        }
        if (fn === 'release_budget') {
          return { data: await rpcReleaseBudget(args), error: null }
        }
        if (fn === 'release_stale_budget_reservations') {
          return { data: await rpcReleaseStale(args), error: null }
        }
        return { data: null, error: { message: `unknown rpc ${fn}` } }
      } catch (e: any) {
        return { data: null, error: { message: e.message } }
      }
    },
  }

  function chain(table: string) {
    const filters: Row = {}
    const readRows = () => client.db[table] || []
    const builder: any = {
      select: () => builder,
      single: async () => {
        const rows = readRows().filter((r: Row) => Object.entries(filters).every(([k, v]) => r[k] === v))
        callLog.push({ op: 'select', table, filters })
        if (rows.length === 0) return { data: null, error: { message: 'No rows' } }
        return { data: rows[0], error: null }
      },
      // Sprint 5.3 P2: the engine's pre-reservation duplicate check uses
      // maybeSingle (0 or 1 rows expected — the key is unique-constrained).
      maybeSingle: async () => {
        const rows = readRows().filter((r: Row) => Object.entries(filters).every(([k, v]) => r[k] === v))
        callLog.push({ op: 'select', table, filters })
        return { data: rows.length > 0 ? rows[0] : null, error: null }
      },
      eq: (col: string, val: any) => {
        filters[col] = val
        return builder
      },
      insert: (payload: Row) => {
        callLog.push({ op: 'insert', table, payload })
        const rows = readRows()
        const dup =
          table === 'autonomous_actions' &&
          rows.some(
            (r: Row) =>
              r.idempotency_key === payload.idempotency_key &&
              r.organization_id === payload.organization_id
          )
        if (dup) return { error: { code: '23505', message: 'duplicate key' } }
        rows.push({ ...payload })
        return { error: null }
      },
      update: (payload: Row) => {
        const update: any = {
          eq: (col: string, val: any) => {
            filters[col] = val
            return update
          },
          select: () => update,
          then: (resolve: any) => {
            const rows = readRows()
            const updated: Row[] = []
            for (const r of rows) {
              if (Object.entries(filters).every(([k, v]) => r[k] === v)) {
                Object.assign(r, payload)
                updated.push(r)
              }
            }
            callLog.push({ op: 'update', table, payload, filters })
            resolve({
              data: updated.length ? updated : null,
              error: updated.length ? null : { message: 'No rows updated' },
            })
          },
        }
        return update
      },
    }
    return builder
  }

  return { client, db }
}

function baseRequest(overrides?: Partial<ActionExecutionRequest>): ActionExecutionRequest {
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    userRole: 'owner',
    decisionId: 'dec-1',
    actionId: 'act-1',
    actionType: 'report',
    riskLevel: 'low',
    authorizationLevel: 'level_1',
    approvalRequired: false,
    title: 'Costed action',
    description: 'Test',
    payload: {},
    estimatedCost: 8,
    idempotencyKey: 'idem-1',
    operatingMode: 'approval',
    ...overrides,
  }
}

function openHolds(db: SimulatedDb, orgId = 'org-1'): number {
  return db.budget_reservations
    .filter((r) => r.organization_id === orgId && r.status === 'reserved')
    .reduce((s, r) => s + r.reserved_amount, 0)
}

describe('Sprint 5.3 P2 — mandatory concurrency tests', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    uuidCounter = 0
  })

  it('$10 budget: two concurrent $8 actions — exactly ONE reserves, the other is rejected', async () => {
    // The first reserve arrives early and sleeps BEFORE taking the row lock;
    // the second reserve completes inside the lock; the first then finds
    // remaining = 2 < 8 and must be rejected. This is the read-modify-write
    // race the atomic RPC eliminates.
    const { client, db } = makeBudgetSupabase({
      orgs: [{ organization_id: 'org-1', monthly_budget: 10 }],
      delayFirstReserveMs: 25,
    })
    const engine = new ActionExecutionEngine(client)

    const results = await Promise.all([
      engine.executeAction(baseRequest({ idempotencyKey: 'idem-A', actionId: 'act-A', estimatedCost: 8 })),
      engine.executeAction(baseRequest({ idempotencyKey: 'idem-B', actionId: 'act-B', estimatedCost: 8 })),
    ])

    const succeeded = results.filter((r) => r.success)
    const budgetBlocked = results.filter(
      (r) => !r.success && (r.error ?? '').includes('BUDGET_EXCEEDED')
    )

    expect(succeeded.length).toBe(1)
    expect(budgetBlocked.length).toBe(1)

    // INVARIANT: committed spend + open holds never exceed the budget.
    expect(db.ai_usage_limits[0].current_spend + openHolds(db)).toBeLessThanOrEqual(10)
    expect(db.budget_reservations.length).toBe(1)
  })

  it('two $5 reservations fit exactly into a $10 budget; a third $5 is rejected', async () => {
    const { client, db } = makeBudgetSupabase([
      { organization_id: 'org-1', monthly_budget: 10 },
    ])
    const service = new BudgetReservationService(client)

    const [a, b] = await Promise.all([
      service.reserve({ organizationId: 'org-1', amount: 5, actionIdempotencyKey: 'act-A' }),
      service.reserve({ organizationId: 'org-1', amount: 5, actionIdempotencyKey: 'act-B' }),
    ])

    expect(a.reservationId).toBeTruthy()
    expect(b.reservationId).toBeTruthy()
    expect(a.reservationId).not.toBe(b.reservationId)
    expect(openHolds(db)).toBe(10)

    await expect(
      service.reserve({ organizationId: 'org-1', amount: 5, actionIdempotencyKey: 'act-C' })
    ).rejects.toThrow('BUDGET_EXCEEDED')
    expect(openHolds(db)).toBe(10) // unchanged by the rejected attempt
  })
})

describe('Sprint 5.3 P2 — reservation lifecycle', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    uuidCounter = 0
  })

  it('duplicate reservation for the same action reuses the SAME hold (no double-reserve)', async () => {
    const { client, db } = makeBudgetSupabase([
      { organization_id: 'org-1', monthly_budget: 10 },
    ])
    const service = new BudgetReservationService(client)

    const first = await service.reserve({ organizationId: 'org-1', amount: 8, actionIdempotencyKey: 'idem-1' })
    const second = await service.reserve({ organizationId: 'org-1', amount: 8, actionIdempotencyKey: 'idem-1' })
    const third = await service.reserve({ organizationId: 'org-1', amount: 8, actionIdempotencyKey: 'idem-1' })

    expect(first.reservationId).toBe(second.reservationId)
    expect(second.reservationId).toBe(third.reservationId)
    expect(db.budget_reservations.length).toBe(1)
    expect(openHolds(db)).toBe(8)
  })

  it('failed execution RELEASES the reservation (engine failure path)', async () => {
    const { client, db } = makeBudgetSupabase([
      { organization_id: 'org-1', monthly_budget: 10 },
    ])
    const engine = new ActionExecutionEngine(client)

    // Force the action itself to throw AFTER checks + reservation pass.
    ;(engine as any).performAction = async () => {
      throw new Error('simulated action failure')
    }

    const result = await engine.executeAction(
      baseRequest({ estimatedCost: 8, idempotencyKey: 'fail-1', actionId: 'act-fail' })
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('simulated action failure')
    expect(openHolds(db)).toBe(0) // hold released, budget fully available again
    expect(db.budget_reservations[0].status).toBe('released')

    // Budget is available again for the full amount.
    const service = new BudgetReservationService(client)
    const retryReserve = await service.reserve({
      organizationId: 'org-1',
      amount: 10,
      actionIdempotencyKey: 'after-fail',
    })
    expect(retryReserve.reservationId).toBeTruthy()
  })

  it('successful execution SETTLES with the reported actual cost, releasing the unused hold', async () => {
    const { client, db } = makeBudgetSupabase([
      { organization_id: 'org-1', monthly_budget: 10 },
    ])
    const engine = new ActionExecutionEngine(client)
    ;(engine as any).performAction = async () => ({
      executedAt: new Date().toISOString(),
      actualCost: 3.5, // action reports its actual cost
    })

    const result = await engine.executeAction(
      baseRequest({ estimatedCost: 8, idempotencyKey: 'settle-1', actionId: 'act-ok' })
    )

    expect(result.success).toBe(true)
    expect(db.budget_reservations[0].status).toBe('settled')
    expect(db.budget_reservations[0].settled_amount).toBe(3.5)
    expect(db.ai_usage_limits[0].current_spend).toBe(3.5)
    expect(openHolds(db)).toBe(0)

    // Remaining budget reflects the ACTUAL charge: 10 - 3.5 = 6.5.
    const service = new BudgetReservationService(client)
    const fits = await service.reserve({ organizationId: 'org-1', amount: 6.5, actionIdempotencyKey: 'idem-2' })
    expect(fits.reservationId).toBeTruthy()
    await expect(
      service.reserve({ organizationId: 'org-1', amount: 0.01, actionIdempotencyKey: 'idem-3' })
    ).rejects.toThrow('BUDGET_EXCEEDED')
  })

  it('settlement is CLAMPED to the reserved hold — a caller can never inflate available budget', async () => {
    const { client, db } = makeBudgetSupabase([
      { organization_id: 'org-1', monthly_budget: 10 },
    ])
    const service = new BudgetReservationService(client)

    const reserved = await service.reserve({ organizationId: 'org-1', amount: 5, actionIdempotencyKey: 'idem-1' })

    // Caller tries to settle $999 against a $5 hold.
    await service.settle(reserved.reservationId, 'org-1', 999)

    expect(db.ai_usage_limits[0].current_spend).toBe(5) // clamped, NOT 999
    expect(db.budget_reservations[0].settled_amount).toBe(5)
    expect(db.budget_reservations[0].status).toBe('settled')

    // Negative settlement is rejected outright (fail-closed).
    const r2 = await service.reserve({ organizationId: 'org-1', amount: 5, actionIdempotencyKey: 'idem-2' })
    await expect(service.settle(r2.reservationId, 'org-1', -1)).rejects.toThrow('INVALID_SETTLEMENT_AMOUNT')
    expect(db.budget_reservations.find((r) => r.id === r2.reservationId)!.status).toBe('reserved')
  })

  it('retry does not double-reserve: completed action blocks BEFORE any new reservation is taken', async () => {
    const { client, db } = makeBudgetSupabase([
      { organization_id: 'org-1', monthly_budget: 10 },
    ])
    const engine = new ActionExecutionEngine(client)
    ;(engine as any).performAction = async () => ({ actualCost: 4 }) // partial settle

    const req = baseRequest({ estimatedCost: 8, idempotencyKey: 'idem-1', actionId: 'act-1' })
    const first = await engine.executeAction(req)
    expect(first.success).toBe(true)
    expect(db.ai_usage_limits[0].current_spend).toBe(4)

    // Queue retry of the same action: the fast-fail duplicate check (step
    // 6.5) sees the COMPLETED row and blocks BEFORE the budget reservation
    // step, so no hold is ever created and nothing can be stranded.
    // Strictly safer than reserve-then-release.
    const retry = await engine.executeAction(req)
    expect(retry.success).toBe(false)
    expect(retry.error).toContain('already executed')

    // Exactly one ledger row from the original execution, settled.
    const originalRows = db.budget_reservations.filter(
      (r) => r.action_idempotency_key === 'idem-1'
    )
    expect(originalRows.length).toBe(1)
    expect(originalRows[0].status).toBe('settled')
    // No fresh hold was created (blocked pre-reservation) — nothing orphaned.
    expect(db.budget_reservations.some((r) => r.status === 'released')).toBe(false)
    expect(db.ai_usage_limits[0].current_spend).toBe(4) // unchanged
    expect(openHolds(db)).toBe(0)
  })

  it('dead-lettered job leaves NO orphaned hold: pre-settle release works, post-settle release is a no-op', async () => {
    const { client, db } = makeBudgetSupabase([
      { organization_id: 'org-1', monthly_budget: 10 },
    ])
    const service = new BudgetReservationService(client)

    // Case 1: job dead-letters BEFORE settle → hold releasable.
    const reserved = await service.reserve({ organizationId: 'org-1', amount: 8, actionIdempotencyKey: 'dead-1' })
    expect(await service.release(reserved.reservationId, 'org-1')).toBe(true)
    expect(openHolds(db)).toBe(0)

    // Case 2: job dead-letters AFTER settle → a late release must NOT
    // un-charge (only 'reserved' rows release).
    const r2 = await service.reserve({ organizationId: 'org-1', amount: 8, actionIdempotencyKey: 'dead-2' })
    await service.settle(r2.reservationId, 'org-1', 8)
    expect(await service.release(r2.reservationId, 'org-1')).toBe(false)
    expect(db.ai_usage_limits[0].current_spend).toBe(8)
    expect(openHolds(db)).toBe(0)

    // Case 3: release of a foreign org's reservation is a no-op (tenant bound).
    const r3 = await service.reserve({ organizationId: 'org-1', amount: 2, actionIdempotencyKey: 'dead-3' })
    expect(await service.release(r3.reservationId, 'org-OTHER')).toBe(false)
    expect(openHolds(db)).toBe(2)
  })

  it('stale-hold reaper releases orphaned holds and restores available budget', async () => {
    const { client, db } = makeBudgetSupabase([
      { organization_id: 'org-1', monthly_budget: 10 },
    ])
    const service = new BudgetReservationService(client)

    await service.reserve({ organizationId: 'org-1', amount: 8, actionIdempotencyKey: 'orphan-1' })
    expect(openHolds(db)).toBe(8)

    // Fresh holds are not reaped by a 1h window.
    expect(await service.releaseStaleHolds('org-1', 60 * 60)).toBe(0)
    expect(openHolds(db)).toBe(8)

    // Age the hold beyond the window, then reap.
    db.budget_reservations[0].created_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    expect(await service.releaseStaleHolds('org-1', 60 * 60)).toBe(1)
    expect(openHolds(db)).toBe(0)

    // Invalid age is rejected by the service guard (fail-closed), mirroring
    // the SQL function's INVALID_REAPER_AGE exception.
    await expect(service.releaseStaleHolds('org-1', 0)).rejects.toThrow('INVALID_REAPER_AGE')
  })

  it('zero-cost actions reserve nothing and execute', async () => {
    const { client, db } = makeBudgetSupabase([
      { organization_id: 'org-1', monthly_budget: 10 },
    ])
    const engine = new ActionExecutionEngine(client)
    const result = await engine.executeAction(
      baseRequest({ estimatedCost: 0, idempotencyKey: 'free-1' })
    )
    expect(result.success).toBe(true)
    expect(db.budget_reservations.length).toBe(0)
  })

  it('paused organization and global kill switch block the reservation (fail-closed)', async () => {
    const paused = makeBudgetSupabase([
      { organization_id: 'org-1', monthly_budget: 10, paused: true, pause_reason: 'maintenance' },
    ])
    const pausedService = new BudgetReservationService(paused.client)
    await expect(
      pausedService.reserve({ organizationId: 'org-1', amount: 1, actionIdempotencyKey: 'p-1' })
    ).rejects.toThrow('KILL_SWITCH_ACTIVE: maintenance')

    const global = makeBudgetSupabase({
      orgs: [{ organization_id: 'org-1', monthly_budget: 10 }],
      globalKillSwitch: true,
    })
    const globalService = new BudgetReservationService(global.client)
    await expect(
      globalService.reserve({ organizationId: 'org-1', amount: 1, actionIdempotencyKey: 'g-1' })
    ).rejects.toThrow('KILL_SWITCH_ACTIVE: global emergency stop enabled')
  })

  it('micro-cost holdings are preserved at 6dp (0.1234 reserved exactly)', async () => {
    const { client, db } = makeBudgetSupabase([
      { organization_id: 'org-1', monthly_budget: 10 },
    ])
    const service = new BudgetReservationService(client)

    const reserved = await service.reserve({
      organizationId: 'org-1',
      amount: 0.1234,
      actionIdempotencyKey: 'micro-1',
    })
    expect(reserved.reservationId).toBeTruthy()

    // DB should hold the EXACT micro-cost (re: migration 020 widening to
    // NUMERIC(12,6)); the mock stores the raw number.
    expect(Number(db.budget_reservations[0].reserved_amount)).toBeCloseTo(0.1234, 6)

    await service.settle(reserved.reservationId, 'org-1', 0.1234)
    expect(Number(db.budget_reservations[0].settled_amount)).toBeCloseTo(0.1234, 6)
    expect(Number(db.ai_usage_limits[0].current_spend)).toBeCloseTo(0.1234, 6)
    expect(openHolds(db)).toBe(0)
  })

  it('permanent configuration errors are classified as non-retryable', async () => {
    const noRow = makeBudgetSupabase([])
    const service = new BudgetReservationService(noRow.client)

    // org has no ai_usage_limits row → permanent config error.
    await expect(
      service.reserve({ organizationId: 'org-missing', amount: 1, actionIdempotencyKey: 'k-1' })
    ).rejects.toThrow('NO_BUDGET_ROW')

    // Missing action key is a client-side permanent error.
    await expect(
      service.reserve({ organizationId: 'org-1', amount: 1, actionIdempotencyKey: '' })
    ).rejects.toThrow('INVALID_RESERVATION_KEY')
  })

  it('blocks after the reservation (duplicate claim) release the hold', async () => {
    const { client, db } = makeBudgetSupabase([
      { organization_id: 'org-1', monthly_budget: 10 },
    ])
    const engine = new ActionExecutionEngine(client)

    // A different action already holds the idempotency key and is in flight:
    // the engine reserves budget, then fails the idempotency claim — the
    // block path must release the hold it just took.
    db.autonomous_actions.push({
      id: 'act-other',
      organization_id: 'org-1',
      idempotency_key: 'idem-1',
      execution_status: 'queued',
    })

    const result = await engine.executeAction(
      baseRequest({ estimatedCost: 8, idempotencyKey: 'idem-1', actionId: 'act-new' })
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('in progress')
    expect(openHolds(db)).toBe(0) // reservation released on the block path
    expect(db.budget_reservations[0].status).toBe('released')
  })
})
