/**
 * Sprint 3 enforcement tests
 *
 * Proves the critical server-side enforcement paths with mocked Supabase:
 * - Approval status/expiry verified against the DB (never trusted from client)
 * - Viewer/Member cannot approve; Owner/Admin can
 * - Cross-org approval access is blocked
 * - Atomic idempotency claim blocks duplicate execution
 * - Shadow mode never dispatches the handler
 * - Kill switch blocks execution
 *
 * These run with vitest (npm test) and need no live database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the AICostController so the engine's budget check is controllable.
vi.mock('@/lib/ai/cost-controller', () => ({
  AICostController: class {
    checkBudget = vi.fn().mockResolvedValue({ allowed: true })
  },
}))

import { ActionExecutionEngine } from '@/lib/sprint3/action-execution-engine'
import type { ActionExecutionRequest } from '@/lib/sprint3/action-execution-engine'

type Row = Record<string, any>

/**
 * Minimal Supabase client mock: a builder with .from(table).select().eq()...
 * chains plus insert/update. The idempotency claim insert enforces a unique
 * (idempotency_key, organization_id) constraint, returning Postgres 23505 on
 * collision — mirroring the real constraint created by
 * supabase/migrations/sprint3_idempotency_claim.sql.
 */
function makeSupabase(tables: Record<string, Row[]>) {
  const callLog: Array<{ op: string; table: string; payload?: any; filters?: Row }> = []
  const client: any = {
    callLog,
    from: (table: string) => chain(table),
  }
  // Share table arrays onto the client so tests can inspect/mutate state
  // (e.g. db.ai_usage_limits = [...]) and the mock sees the change.
  Object.assign(client, tables)

  function chain(table: string) {
    const filters: Row = {}
    const readRows = () => client[table] || []
    const builder: any = {
      select: () => builder,
      single: async () => {
        const rows = readRows().filter((r: Row) =>
          Object.entries(filters).every(([k, v]) => r[k] === v)
        )
        callLog.push({ op: 'select', table, filters })
        if (rows.length === 0) return { data: null, error: { message: 'No rows' } }
        return { data: rows[0], error: null }
      },
      eq: (col: string, val: any) => {
        filters[col] = val
        return builder
      },
      insert: (payload: Row) => {
        callLog.push({ op: 'insert', table, payload })
        const rows = readRows()
        const dup =
          // Claim uniqueness: (idempotency_key, organization_id)
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
          // Terminal: apply update to matching rows.
          then: (resolve: any) => {
            const rows = readRows()
            let matched = 0
            for (const r of rows) {
              if (Object.entries(filters).every(([k, v]) => r[k] === v)) {
                Object.assign(r, payload)
                matched++
              }
            }
            callLog.push({ op: 'update', table, payload, filters })
            resolve({ data: matched ? rows : null, error: matched ? null : { message: 'No rows updated' } })
          },
        }
        return update
      },
    }
    return builder
  }

  return client
}

function baseRequest(overrides?: Partial<ActionExecutionRequest>): ActionExecutionRequest {
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    userRole: 'admin',
    decisionId: 'dec-1',
    actionId: 'act-1',
    actionType: 'report',
    riskLevel: 'low',
    authorizationLevel: 'level_1',
    approvalRequired: false,
    title: 'Test action',
    description: 'Test',
    payload: {},
    idempotencyKey: 'idem-1',
    operatingMode: 'approval',
    ...overrides,
  }
}

function seedDb(overrides?: {
  members?: Row[]
  approvals?: Row[]
  actions?: Row[]
  limits?: Row[]
}) {
  const state: Record<string, Row[]> = {
    organization_members: overrides?.members ?? [
      { id: 'm1', user_id: 'user-1', organization_id: 'org-1', role: 'admin' },
    ],
    approval_requests: overrides?.approvals ?? [],
    autonomous_actions: overrides?.actions ?? [],
    ai_usage_limits: overrides?.limits ?? [
      { organization_id: 'org-1', paused: false, pause_reason: null },
    ],
    audit_logs: [],
    action_outcomes: [],
  }
  return Object.assign(makeSupabase(state), state)
}

describe('Sprint 3 enforcement', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('blocks when no approval exists and approval is required', async () => {
    const db = seedDb({ approvals: [] })
    const engine = new ActionExecutionEngine(db as any)
    const result = await engine.executeAction(baseRequest({ approvalRequired: true }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('No approval found')
  })

  it('blocks when approval is still pending', async () => {
    const db = seedDb({
      approvals: [
        { decision_id: 'dec-1', organization_id: 'org-1', approval_status: 'pending' },
      ],
    })
    const engine = new ActionExecutionEngine(db as any)
    const result = await engine.executeAction(baseRequest({ approvalRequired: true }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('pending')
  })

  it('allows execution with an approved, unexpired approval', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const db = seedDb({
      approvals: [
        {
          decision_id: 'dec-1',
          organization_id: 'org-1',
          approval_status: 'approved',
          response_deadline: future,
        },
      ],
    })
    const engine = new ActionExecutionEngine(db as any)
    const result = await engine.executeAction(baseRequest({ approvalRequired: true }))
    expect(result.success).toBe(true)
  })

  it('blocks when the approval has expired', async () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const db = seedDb({
      approvals: [
        {
          decision_id: 'dec-1',
          organization_id: 'org-1',
          approval_status: 'approved',
          response_deadline: past,
        },
      ],
    })
    const engine = new ActionExecutionEngine(db as any)
    const result = await engine.executeAction(baseRequest({ approvalRequired: true }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('expired')
  })

  it('blocks a non-member of the organization', async () => {
    const db = seedDb({ members: [] })
    const engine = new ActionExecutionEngine(db as any)
    const result = await engine.executeAction(baseRequest())
    expect(result.success).toBe(false)
    expect(result.error).toContain('member')
  })

  it('blocks viewer role on level_1 actions', async () => {
    const db = seedDb({
      members: [
        { id: 'm1', user_id: 'user-1', organization_id: 'org-1', role: 'viewer' },
      ],
    })
    const engine = new ActionExecutionEngine(db as any)
    const result = await engine.executeAction(baseRequest({ userRole: 'viewer' }))
    expect(result.success).toBe(false)
  })

  it('blocks member role on level_2+ actions', async () => {
    const db = seedDb({
      members: [
        { id: 'm1', user_id: 'user-1', organization_id: 'org-1', role: 'member' },
      ],
    })
    const engine = new ActionExecutionEngine(db as any)
    const result = await engine.executeAction(
      baseRequest({ userRole: 'member', authorizationLevel: 'level_2' })
    )
    expect(result.success).toBe(false)
  })

  it('never auto-approves critical risk', async () => {
    const db = seedDb({
      members: [
        { id: 'm1', user_id: 'user-1', organization_id: 'org-1', role: 'owner' },
      ],
    })
    const engine = new ActionExecutionEngine(db as any)
    const result = await engine.executeAction(
      baseRequest({ userRole: 'owner', riskLevel: 'critical', authorizationLevel: 'level_4' })
    )
    expect(result.success).toBe(false)
  })

  it('blocks execution when the org kill switch is paused', async () => {
    const db = seedDb({
      limits: [{ organization_id: 'org-1', paused: true, pause_reason: 'maintenance' }],
    })
    const engine = new ActionExecutionEngine(db as any)
    const result = await engine.executeAction(baseRequest())
    expect(result.success).toBe(false)
    // The engine surfaces the org's pause_reason as the block reason.
    expect(result.error).toContain('maintenance')
  })

  it('blocks a duplicate execution after the action completed', async () => {
    const db = seedDb()
    const engine = new ActionExecutionEngine(db as any)

    const first = await engine.executeAction(baseRequest())
    expect(first.success).toBe(true)

    // Second run with the SAME key: the completed row is found → blocked.
    const second = await engine.executeAction(baseRequest())
    expect(second.success).toBe(false)
    expect(second.error).toContain('already executed')

    // Exactly one action record exists for the key.
    const claims = db.autonomous_actions.filter(
      (a: Row) => a.idempotency_key === 'idem-1'
    )
    expect(claims.length).toBe(1)
  })

  it('blocks a concurrent claim while another execution is in progress', async () => {
    const db = seedDb({
      actions: [
        {
          id: 'act-other',
          organization_id: 'org-1',
          idempotency_key: 'idem-1',
          execution_status: 'queued',
        },
      ],
    })
    const engine = new ActionExecutionEngine(db as any)
    const result = await engine.executeAction(baseRequest())
    expect(result.success).toBe(false)
    expect(result.error).toContain('in progress')
  })

  it('allows a retry after a failed execution', async () => {
    const db = seedDb({
      actions: [
        {
          id: 'act-1',
          organization_id: 'org-1',
          idempotency_key: 'idem-1',
          execution_status: 'failed',
        },
      ],
    })
    const engine = new ActionExecutionEngine(db as any)
    const result = await engine.executeAction(baseRequest())
    expect(result.success).toBe(true)
  })

  it('shadow mode records but never executes the handler', async () => {
    const db = seedDb()
    const engine = new ActionExecutionEngine(db as any)
    const result = await engine.executeAction(baseRequest({ operatingMode: 'shadow' }))
    expect(result.success).toBe(true)
    expect(result.result?.executed).toBe(false)
    // A shadow audit event was written.
    const shadowLogs = db.audit_logs.filter((l: Row) => l.action === 'action_shadow_mode')
    expect(shadowLogs.length).toBe(1)
  })
})

describe('Sprint 3 ApprovalManager', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  async function withManager(db: any) {
    const { ApprovalManager } = await import('@/lib/sprint3/approval-manager')
    return new ApprovalManager(db)
  }

  function managerDb(rows: { members?: Row[]; approvals?: Row[]; actions?: Row[] }) {
    const state: Record<string, Row[]> = {
      organization_members: rows.members ?? [
        { id: 'm1', user_id: 'user-1', organization_id: 'org-1', role: 'admin' },
      ],
      approval_requests: rows.approvals ?? [],
      autonomous_actions: rows.actions ?? [],
      audit_logs: [],
    }
    return Object.assign(makeSupabase(state), state)
  }

  it('viewer cannot approve', async () => {
    const db = managerDb({
      members: [
        { id: 'm1', user_id: 'user-1', organization_id: 'org-1', role: 'viewer' },
      ],
    })
    const manager = await withManager(db)
    const result = await manager.approveAction('apr-1', 'user-1', 'org-1')
    expect(result.success).toBe(false)
  })

  it('owner can approve a pending request', async () => {
    const db = managerDb({
      members: [
        { id: 'm1', user_id: 'user-1', organization_id: 'org-1', role: 'owner' },
      ],
      approvals: [
        { id: 'apr-1', organization_id: 'org-1', approval_status: 'pending' },
      ],
    })
    const manager = await withManager(db)
    const result = await manager.approveAction('apr-1', 'user-1', 'org-1')
    expect(result.success).toBe(true)
    expect(db.approval_requests[0].approval_status).toBe('approved')
    // Audit trail written.
    expect(db.audit_logs.some((l: Row) => l.action === 'approval_approved')).toBe(true)
  })

  it('cannot approve the same request twice', async () => {
    const db = managerDb({
      approvals: [
        { id: 'apr-1', organization_id: 'org-1', approval_status: 'approved' },
      ],
    })
    const manager = await withManager(db)
    const result = await manager.approveAction('apr-1', 'user-1', 'org-1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot approve')
  })

  it('cancels a pending request', async () => {
    const db = managerDb({
      approvals: [
        { id: 'apr-1', organization_id: 'org-1', approval_status: 'pending' },
      ],
    })
    const manager = await withManager(db)
    const result = await manager.cancelAction('apr-1', 'user-1', 'org-1', 'not needed')
    expect(result.success).toBe(true)
    expect(db.approval_requests[0].approval_status).toBe('cancelled')
  })

  it('cannot cancel an already-approved request', async () => {
    const db = managerDb({
      approvals: [
        { id: 'apr-1', organization_id: 'org-1', approval_status: 'approved' },
      ],
    })
    const manager = await withManager(db)
    const result = await manager.cancelAction('apr-1', 'user-1', 'org-1', 'nope')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot cancel')
  })

  it('rejects approval access from another organization', async () => {
    const db = managerDb({
      approvals: [
        { id: 'apr-1', organization_id: 'org-OTHER', approval_status: 'pending' },
      ],
    })
    const manager = await withManager(db)
    // user asks for org-1, but the approval lives in org-OTHER → not found.
    const result = await manager.approveAction('apr-1', 'user-1', 'org-1')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('returns action status scoped to the organization', async () => {
    const db = managerDb({
      actions: [
        { id: 'act-1', organization_id: 'org-1', execution_status: 'completed' },
      ],
    })
    const manager = await withManager(db)
    const found = await manager.getActionStatus('act-1', 'org-1')
    expect(found?.execution_status).toBe('completed')
    const missing = await manager.getActionStatus('act-1', 'org-OTHER')
    expect(missing).toBeNull()
  })
})
