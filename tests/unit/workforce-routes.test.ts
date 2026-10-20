/**
 * Phase A: /api/workforce routes + lib/workforce/service
 *
 * The rules themselves are enforced and tested in the database
 * (tests/sql/workforce_phase_a_test.sql). These tests prove the application
 * layer fails closed and passes requests to the enforced functions unchanged:
 * no session -> 401, bad input -> 400, engine refusals map to 403/404/409,
 * identity is never taken from the request body.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    throw new Error('createClient not configured in test')
  }),
}))

import { createClient } from '@/lib/supabase/server'
import { POST as createTaskRoute } from '@/app/api/workforce/tasks/route'
import { GET as timelineRoute } from '@/app/api/workforce/tasks/[taskId]/route'
import { POST as decideRoute } from '@/app/api/workforce/approvals/[approvalId]/route'
import { toWorkforceError, getTaskTimeline } from '@/lib/workforce/service'
import type { NextRequest } from 'next/server'

const ORG = '11111111-1111-4111-8111-111111111111'
const AGENT = '22222222-2222-4222-8222-222222222222'
const TASK = '33333333-3333-4333-8333-333333333333'
const APPROVAL = '44444444-4444-4444-8444-444444444444'

type RpcReply = { data: any; error: { message: string } | null }

/** Chainable query stub: every builder method returns itself; awaiting yields `reply`. */
function query(reply: RpcReply) {
  const q: any = {}
  for (const m of ['select', 'eq', 'not', 'order']) q[m] = vi.fn(() => q)
  q.maybeSingle = vi.fn(async () => reply)
  q.then = (resolve: (v: RpcReply) => unknown) => resolve(reply)
  return q
}

function client(opts: { user?: { id: string } | null; rpc?: RpcReply; tables?: Record<string, RpcReply> }) {
  const rpc = vi.fn(async () => opts.rpc ?? { data: null, error: null })
  const from = vi.fn((table: string) => query(opts.tables?.[table] ?? { data: [], error: null }))
  const c = {
    auth: { getUser: vi.fn(async () => ({ data: { user: opts.user === undefined ? { id: 'user-1' } : opts.user } })) },
    rpc,
    from,
  }
  vi.mocked(createClient).mockResolvedValue(c as any)
  return c
}

const req = (body: unknown) =>
  ({ json: async () => (typeof body === 'string' ? JSON.parse(body) : body) }) as unknown as NextRequest

const validTask = { organizationId: ORG, agentId: AGENT, title: 'Weekly SEO report', requiredTool: 'report.write' }

beforeEach(() => vi.clearAllMocks())

describe('POST /api/workforce/tasks', () => {
  it('returns 401 without a session and never calls the engine', async () => {
    const c = client({ user: null })
    const res = await createTaskRoute(req(validTask))
    expect(res.status).toBe(401)
    expect(c.rpc).not.toHaveBeenCalled()
  })

  it('rejects a task without a declared tool (deny by default)', async () => {
    const c = client({})
    const res = await createTaskRoute(req({ ...validTask, requiredTool: ' ' }))
    expect(res.status).toBe(400)
    expect(c.rpc).not.toHaveBeenCalled()
  })

  it('rejects malformed ids, priorities and dependencies', async () => {
    client({})
    expect((await createTaskRoute(req({ ...validTask, agentId: 'nope' }))).status).toBe(400)
    expect((await createTaskRoute(req({ ...validTask, priority: 'asap' }))).status).toBe(400)
    expect((await createTaskRoute(req({ ...validTask, dependsOn: ['x'] }))).status).toBe(400)
  })

  it('creates through workforce_create_task and ignores any assigner in the body', async () => {
    const c = client({ rpc: { data: { ok: true, task_id: TASK }, error: null } })
    const res = await createTaskRoute(req({ ...validTask, assignedByAgentId: AGENT, dedupeKey: 'seo:w43' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ taskId: TASK, duplicate: false })
    expect(c.rpc).toHaveBeenCalledWith('workforce_create_task', expect.objectContaining({
      p_organization_id: ORG, p_agent_id: AGENT, p_required_tool: 'report.write',
      p_required_resource: '*', p_dedupe_key: 'seo:w43', p_assigned_by_agent_id: null,
    }))
  })

  it('returns the existing task for a duplicate dedupe key', async () => {
    client({ rpc: { data: { ok: false, reason: 'duplicate', task_id: TASK }, error: null } })
    const res = await createTaskRoute(req({ ...validTask, dedupeKey: 'seo:w43' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ taskId: TASK, duplicate: true })
  })

  it('maps a membership refusal from the database to 403', async () => {
    client({ rpc: { data: null, error: { message: 'WORKFORCE_FORBIDDEN: not a member of this organization' } } })
    const res = await createTaskRoute(req(validTask))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden')
  })
})

describe('POST /api/workforce/approvals/:id', () => {
  const params = { params: { approvalId: APPROVAL } }

  it('returns 401 without a session', async () => {
    const c = client({ user: null })
    expect((await decideRoute(req({ decision: 'approved' }), params)).status).toBe(401)
    expect(c.rpc).not.toHaveBeenCalled()
  })

  it('rejects anything other than approved or rejected', async () => {
    const c = client({})
    expect((await decideRoute(req({ decision: 'yes' }), params)).status).toBe(400)
    expect(c.rpc).not.toHaveBeenCalled()
  })

  it('decides through workforce_decide_approval', async () => {
    const c = client({ rpc: { data: { ok: true, decision: 'approved' }, error: null } })
    const res = await decideRoute(req({ decision: 'approved', note: 'ok' }), params)
    expect(res.status).toBe(200)
    expect(c.rpc).toHaveBeenCalledWith('workforce_decide_approval',
      { p_approval_id: APPROVAL, p_decision: 'approved', p_note: 'ok' })
  })

  it('returns 403 when the engine refuses a non-admin', async () => {
    client({ rpc: { data: { ok: false, reason: 'forbidden' }, error: null } })
    expect((await decideRoute(req({ decision: 'approved' }), params)).status).toBe(403)
  })

  it('returns 409 for an already-decided approval', async () => {
    client({ rpc: { data: { ok: false, reason: 'already_decided', status: 'approved' }, error: null } })
    expect((await decideRoute(req({ decision: 'rejected' }), params)).status).toBe(409)
  })
})

describe('GET /api/workforce/tasks/:id', () => {
  const params = { params: { taskId: TASK } }

  it('returns 401 without a session', async () => {
    client({ user: null })
    expect((await timelineRoute(req({}), params)).status).toBe(401)
  })

  it('returns 404 when row-level security hides the task', async () => {
    client({ tables: { tasks: { data: null, error: null } } })
    expect((await timelineRoute(req({}), params)).status).toBe(404)
  })

  it('returns the task with its events, deliverables, approvals and dependencies', async () => {
    const event = { id: 'e1', event_type: 'workforce.task_created', task_id: TASK }
    const deliverable = { id: 'd1', task_id: TASK, event_id: 'e1', verified: false }
    client({
      tables: {
        tasks: { data: { id: TASK, status: 'working' }, error: null },
        activity_events: { data: [event], error: null },
        workforce_deliverables: { data: [deliverable], error: null },
      },
    })
    const res = await timelineRoute(req({}), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.status).toBe('working')
    expect(body.events).toEqual([event])
    expect(body.deliverables).toEqual([deliverable])
    expect(body.approvals).toEqual([])
  })
})

describe('toWorkforceError', () => {
  it.each([
    ['APPROVAL_FORBIDDEN: approvals require a signed-in owner or admin', 403],
    ['permission denied for function workforce_claim_task', 403],
    ['TASK_TRANSITION_REJECTED: queued -> completed is not an allowed transition', 409],
    ['EVENT_IMMUTABLE: activity_events is append-only', 409],
    ['INVALID_TASK: title is required', 400],
    ['APPROVAL_NOT_FOUND', 404],
  ])('maps %s to %i', (message, status) => {
    expect(toWorkforceError({ message }).status).toBe(status)
  })

  it('does not leak unknown database errors', () => {
    const e = toWorkforceError({ message: 'relation "secret_table" does not exist' })
    expect(e.status).toBe(500)
    expect(e.message).toBe('Workforce request failed')
  })
})

describe('getTaskTimeline', () => {
  it('surfaces a read error instead of returning partial history', async () => {
    const c = client({
      tables: {
        tasks: { data: { id: TASK }, error: null },
        activity_events: { data: null, error: { message: 'permission denied for table activity_events' } },
      },
    })
    await expect(getTaskTimeline(c as any, TASK)).rejects.toMatchObject({ status: 403 })
  })
})
