/**
 * Sprint 5.3: /api/jobs/enqueue + /api/jobs/tick security tests
 *
 * Proves both routes fail closed:
 * - enqueue: 401 without session, 403 for non-members, 400 for invalid
 *   payloads/types, 500 surfaces queue errors, success passes server-derived
 *   identity into the queue
 * - tick: 503 when CRON_SECRET is unset, 401 on missing/wrong bearer token
 */

import { describe, it, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    throw new Error('createClient not configured in test')
  }),
}))

vi.mock('@/lib/jobs/queue', async (importOriginal) => {
  const mod: any = await importOriginal()
  return {
    ...mod,
    BackgroundJobQueue: class {
      enqueue = mocks.enqueue
      claim = vi.fn(async () => [])
      complete = vi.fn(async () => true)
      fail = vi.fn(async () => 'noop' as const)
    },
  }
})

vi.mock('@/lib/jobs/maintenance', async (importOriginal) => {
  const mod: any = await importOriginal()
  return {
    ...mod,
    MaintenanceScheduler: class {
      scheduleApprovalSweeps = vi.fn(async () => ({ scheduled: 0, errors: [] }))
      scheduleEmbeddingBackfills = vi.fn(async () => ({ scheduled: 0, errors: [] }))
      // Sprint 5.3 P2: budget reconciliation sweep added to the tick path.
      scheduleBudgetReconciliation = vi.fn(async () => ({ scheduled: 0, errors: [] }))
    },
    // The tick route also drives AI Authority scheduling. Without this stub the
    // real scheduler runs against the fake Supabase URL and the test hangs until
    // the timeout rather than exercising the route's behaviour.
    AuthorityScheduler: class {
      scheduleAll = vi.fn(async () => ({ daily: 0, weekly: 0, monthly: 0, errors: [] }))
    },
  }
})

import { createClient } from '@/lib/supabase/server'
import { POST as enqueueRoute } from '@/app/api/jobs/enqueue/route'
import { POST as tickRoute } from '@/app/api/jobs/tick/route'
import type { NextRequest } from 'next/server'

function setupAuth(opts: { user: { id: string } | null; member: { id: string } | null }) {
  const memberQuery = {
    select: () => memberQuery,
    eq: () => memberQuery,
    single: async () => ({
      data: opts.member,
      error: opts.member ? null : { message: 'No rows' },
    }),
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: opts.user }, error: null }) },
    from: (_t: string) => memberQuery,
  }
  ;(createClient as any).mockImplementation(async () => client)
}

function makeRequest(url: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return {
    json: body === undefined ? undefined : async () => body,
    url,
    headers: new Headers(headers),
  } as unknown as NextRequest
}

describe('POST /api/jobs/enqueue', () => {
  it('returns 401 without a session and never reaches the queue', async () => {
    setupAuth({ user: null, member: null })
    const res = await enqueueRoute(
      makeRequest(
        'http://localhost/api/jobs/enqueue',
        { organizationId: 'org-1', jobType: 'embedding_backfill' }
      )
    )
    expect(res.status).toBe(401)
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-member of the target organization', async () => {
    setupAuth({ user: { id: 'u1' }, member: null })
    const res = await enqueueRoute(
      makeRequest(
        'http://localhost/api/jobs/enqueue',
        { organizationId: 'org-1', jobType: 'embedding_backfill' }
      )
    )
    expect(res.status).toBe(403)
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('rejects unknown job types (400)', async () => {
    setupAuth({ user: { id: 'u1' }, member: { id: 'm1' } })
    const res = await enqueueRoute(
      makeRequest(
        'http://localhost/api/jobs/enqueue',
        { organizationId: 'org-1', jobType: 'nuke_everything' }
      )
    )
    expect(res.status).toBe(400)
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('requires actionId/idempotencyKey in payload for execute_autonomous_action', async () => {
    setupAuth({ user: { id: 'u1' }, member: { id: 'm1' } })
    const res = await enqueueRoute(
      makeRequest(
        'http://localhost/api/jobs/enqueue',
        { organizationId: 'org-1', jobType: 'execute_autonomous_action', payload: {} }
      )
    )
    expect(res.status).toBe(400)
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('enqueues with server-derived identity for a valid member request', async () => {
    setupAuth({ user: { id: 'u1' }, member: { id: 'm1' } })
    mocks.enqueue.mockResolvedValue({ jobId: 'job-9', deduplicated: false })

    const res = await enqueueRoute(
      makeRequest(
        'http://localhost/api/jobs/enqueue',
        { organizationId: 'org-1', jobType: 'embedding_backfill', idempotencyKey: 'k1' }
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.jobId).toBe('job-9')
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'embedding_backfill',
        organizationId: 'org-1',
        idempotencyKey: 'k1',
        createdBy: 'u1',
      })
    )
  })

  it('surfaces queue errors as 500', async () => {
    setupAuth({ user: { id: 'u1' }, member: { id: 'm1' } })
    mocks.enqueue.mockResolvedValue({ jobId: null, deduplicated: false, error: 'rls denied' })

    const res = await enqueueRoute(
      makeRequest(
        'http://localhost/api/jobs/enqueue',
        { organizationId: 'org-1', jobType: 'embedding_backfill' }
      )
    )
    expect(res.status).toBe(500)
  })
})

describe('POST /api/jobs/tick', () => {
  const SECRET_ENV = process.env.CRON_SECRET
  const SUPABASE_ENV = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }

  function restore() {
    if (SECRET_ENV === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = SECRET_ENV
    if (SUPABASE_ENV.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ENV.url
    if (SUPABASE_ENV.anon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SUPABASE_ENV.anon
  }

  it('returns 503 when CRON_SECRET is not configured (fail-closed)', async () => {
    delete process.env.CRON_SECRET
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    try {
      const res = await tickRoute(
        makeRequest('http://localhost/api/jobs/tick', undefined, {
          authorization: 'Bearer whatever',
        })
      )
      expect(res.status).toBe(503)
    } finally {
      restore()
    }
  })

  it('returns 401 on a missing or wrong bearer token', async () => {
    process.env.CRON_SECRET = 's3cret'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    try {
      const noAuth = await tickRoute(makeRequest('http://localhost/api/jobs/tick'))
      expect(noAuth.status).toBe(401)

      const wrongAuth = await tickRoute(
        makeRequest('http://localhost/api/jobs/tick', undefined, {
          authorization: 'Bearer wrong',
        })
      )
      expect(wrongAuth.status).toBe(401)
    } finally {
      restore()
    }
  })

  it('runs maintenance + a worker batch with a valid token', async () => {
    process.env.CRON_SECRET = 's3cret'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    try {
      const res = await tickRoute(
        makeRequest('http://localhost/api/jobs/tick', undefined, {
          authorization: 'Bearer s3cret',
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.worker.claimed).toBe(0)
      expect(body.maintenance.approvalSweeps.scheduled).toBe(0)
      // Authority scheduling is part of the tick contract: one call per tick,
      // internally bucket-idempotent so a frequent cron cannot over-schedule.
      expect(body.authority).toEqual({ daily: 0, weekly: 0, monthly: 0, errors: [] })
    } finally {
      restore()
    }
  })
})
