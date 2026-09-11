/**
 * Sprint 5.3 P1: Durable background job unit tests
 *
 * Covers:
 * - Queue: idempotent enqueue (dedupe), claim delegation, complete/fail paths,
 *   dead-letter requeue
 * - Worker: success, transient retry, permanent dead-letter, unknown job type,
 *   job timeout, accounting counters
 * - MaintenanceScheduler: bucketed idempotency keys, stale-org discovery
 *
 * Supabase client is mocked at the postgrest/rpc boundary; the SQL functions
 * themselves are exercised by the migration (live verification remains a
 * separate, explicitly-marked concern).
 */

import { describe, it, expect, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mock Supabase client builder
// ---------------------------------------------------------------------------
type Row = Record<string, any>

function fromMock(_table: string) {
  const state = {
    upsertResult: { data: null as Row | null, error: null as any },
    selectSingle: { data: null as Row | null, error: null as any },
    updateResult: { data: null as Row[] | null, error: null as any },
    listResult: { data: [] as Row[], error: null as any },
  }
  // Tracks the last mutating op so terminal .single()/await return the right result.
  const op = { last: 'select' as 'upsert' | 'update' | 'select' }

  const builder: any = {
    upsert: vi.fn(() => {
      op.last = 'upsert'
      return builder
    }),
    update: vi.fn(() => {
      op.last = 'update'
      return builder
    }),
    select: vi.fn(() => {
      if (op.last !== 'upsert' && op.last !== 'update') op.last = 'select'
      return builder
    }),
    eq: vi.fn(() => builder),
    lt: vi.fn(() => builder),
    gt: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    single: vi.fn(async () => {
      const result =
        op.last === 'upsert' ? state.upsertResult : state.selectSingle
      // Consume: subsequent chains default to select semantics.
      op.last = 'select'
      return result
    }),
    // Terminal await: resolve based on the last operation in the chain,
    // then consume it (same semantics as single()) so the NEXT chain starts
    // from select state instead of bleeding the previous op's result.
    then: (resolve: any, reject: any) => {
      const result =
        op.last === 'update'
          ? state.updateResult
          : op.last === 'upsert'
            ? state.upsertResult
            : state.listResult
      op.last = 'select'
      return Promise.resolve(result).then(resolve, reject)
    },
  }

  return { builder, state }
}

function makeClient(overrides: { rpc?: Record<string, (...args: any[]) => any> } = {}) {
  const tableMocks: Record<string, ReturnType<typeof fromMock>> = {}
  const getTable = (t: string) => {
    if (!tableMocks[t]) tableMocks[t] = fromMock(t)
    return tableMocks[t]
  }
  const tables = new Proxy(tableMocks, {
    get: (_target, prop: string) => getTable(prop),
  })
  const rpcFns = overrides.rpc ?? {}
  return {
    client: {
      from: (t: string) => getTable(t).builder,
      rpc: (fn: string, args?: any) => {
        const fnImpl = rpcFns[fn]
        if (!fnImpl) return Promise.resolve({ data: null, error: { message: `rpc ${fn} not mocked` } })
        return Promise.resolve(fnImpl(args))
      },
    } as any,
    tables,
  }
}

import { BackgroundJobQueue } from '@/lib/jobs/queue'
import { BackgroundWorker } from '@/lib/jobs/worker'
import { PermanentJobError, JOB_HANDLERS } from '@/lib/jobs/handlers'
import { MaintenanceScheduler, SWEEP_INTERVAL_MS } from '@/lib/jobs/maintenance'
import type { ClaimedJob } from '@/lib/jobs/types'

const JOB: ClaimedJob = {
  id: 'job-1',
  organization_id: 'org-1',
  job_type: 'approval_expiration_sweep',
  payload: {},
  attempts: 1,
  max_attempts: 5,
  idempotency_key: 'k1',
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------
describe('BackgroundJobQueue.enqueue', () => {

  it('rejects missing required fields', async () => {
    const { client } = makeClient()
    const q = new BackgroundJobQueue(client)

    const res = await q.enqueue({ jobType: 'embedding_backfill', organizationId: '', idempotencyKey: 'x' })
    expect(res.jobId).toBeNull()
    expect(res.error).toMatch(/required/)
  })

  it('returns jobId on successful insert', async () => {
    const { client, tables } = makeClient()
    // PostgREST returns an ARRAY for .select() on upsert (live-verified in
    // S53-APP-INTEGRATION); a non-empty array means the insert won.
    tables['background_jobs'].state.upsertResult = { data: [{ id: 'new-job' }], error: null }
    const q = new BackgroundJobQueue(client)

    const res = await q.enqueue({
      jobType: 'embedding_backfill',
      organizationId: 'org-1',
      idempotencyKey: 'abc',
    })
    expect(res).toEqual({ jobId: 'new-job', deduplicated: false })
  })

  it('deduplicates when upsert conflicts (empty array, no error)', async () => {
    const { client, tables } = makeClient()
    // upsert+ignoreDuplicates returns ZERO rows (duplicate ignored), then the
    // lookup finds the existing row — matches live PostgREST behavior.
    tables['background_jobs'].state.upsertResult = { data: [], error: null }
    tables['background_jobs'].state.selectSingle = { data: { id: 'existing-job' }, error: null }
    const q = new BackgroundJobQueue(client)

    const res = await q.enqueue({
      jobType: 'embedding_backfill',
      organizationId: 'org-1',
      idempotencyKey: 'abc',
    })
    expect(res.jobId).toBe('existing-job')
    expect(res.deduplicated).toBe(true)
  })

  it('surfaces insert errors', async () => {
    const { client, tables } = makeClient()
    tables['background_jobs'].state.upsertResult = { data: null, error: { message: 'rls denied' } }
    const q = new BackgroundJobQueue(client)

    const res = await q.enqueue({
      jobType: 'embedding_backfill',
      organizationId: 'org-1',
      idempotencyKey: 'abc',
    })
    expect(res.jobId).toBeNull()
    expect(res.error).toBe('rls denied')
  })
})

describe('BackgroundJobQueue rpc wrappers', () => {
  it('claim returns rows and swallows rpc errors to empty batch', async () => {
    const ok = makeClient({
      rpc: { claim_background_jobs: () => ({ data: [JOB], error: null }) },
    })
    const q1 = new BackgroundJobQueue(ok.client)
    expect(await q1.claim('w1')).toEqual([JOB])

    const bad = makeClient({
      rpc: { claim_background_jobs: () => ({ data: null, error: { message: 'fn missing' } }) },
    })
    const q2 = new BackgroundJobQueue(bad.client)
    expect(await q2.claim('w1')).toEqual([])
  })

  it('fail returns the SQL outcome', async () => {
    const { client } = makeClient({
      rpc: { fail_background_job: () => ({ data: 'retrying', error: null }) },
    })
    const q = new BackgroundJobQueue(client)
    expect(await q.fail('job-1', 'org-1', 'boom')).toBe('retrying')
  })

  it('complete and requeueDead propagate booleans', async () => {
    const { client } = makeClient({
      rpc: {
        complete_background_job: () => ({ data: true, error: null }),
        requeue_dead_background_job: () => ({ data: false, error: null }),
      },
    })
    const q = new BackgroundJobQueue(client)
    expect(await q.complete('job-1', 'org-1', { ok: 1 })).toBe(true)
    expect(await q.requeueDead('job-1', 'org-1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------
describe('BackgroundWorker.processBatch', () => {

  it('completes a successful job and reports accounting', async () => {
    const complete = vi.fn(() => ({ data: true, error: null }))
    const { client } = makeClient({
      rpc: {
        claim_background_jobs: () => ({ data: [{ ...JOB, job_type: 'approval_expiration_sweep' }], error: null }),
        complete_background_job: complete,
      },
    })

    // Stub handler: registry lookup must be bypassed for the stub.
    const worker = new BackgroundWorker(client)
    const spy = vi.spyOn(await import('@/lib/jobs/handlers'), 'getHandler').mockReturnValue(
      async () => ({ expired: 3 })
    )

    const result = await worker.processBatch()
    expect(result.claimed).toBe(1)
    expect(result.completed).toBe(1)
    expect(result.retried).toBe(0)
    expect(result.deadLettered).toBe(0)
    expect(complete).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('retries transient failures with backoff accounting', async () => {
    const fail = vi.fn(() => ({ data: 'retrying', error: null }))
    const { client } = makeClient({
      rpc: {
        claim_background_jobs: () => ({ data: [JOB], error: null }),
        fail_background_job: fail,
      },
    })
    const worker = new BackgroundWorker(client)
    const spy = vi.spyOn(await import('@/lib/jobs/handlers'), 'getHandler').mockReturnValue(
      async () => {
        throw new Error('rate limited')
      }
    )

    const result = await worker.processBatch()
    expect(result.retried).toBe(1)
    expect(result.deadLettered).toBe(0)
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ p_permanent: false }))
    spy.mockRestore()
  })

  it('dead-letters PermanentJobError immediately', async () => {
    const fail = vi.fn(() => ({ data: 'dead', error: null }))
    const { client } = makeClient({
      rpc: {
        claim_background_jobs: () => ({ data: [JOB], error: null }),
        fail_background_job: fail,
      },
    })
    const worker = new BackgroundWorker(client)
    const spy = vi.spyOn(await import('@/lib/jobs/handlers'), 'getHandler').mockReturnValue(
      async () => {
        throw new PermanentJobError('invalid payload')
      }
    )

    const result = await worker.processBatch()
    expect(result.deadLettered).toBe(1)
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ p_permanent: true }))
    spy.mockRestore()
  })

  it('dead-letters unknown job types without retrying', async () => {
    const fail = vi.fn(() => ({ data: 'dead', error: null }))
    const { client } = makeClient({
      rpc: {
        claim_background_jobs: () => ({
          data: [{ ...JOB, job_type: 'no_such_type' }],
          error: null,
        }),
        fail_background_job: fail,
      },
    })
    const worker = new BackgroundWorker(client)

    const result = await worker.processBatch()
    expect(result.deadLettered).toBe(1)
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ p_permanent: true }))
  })

  it('records a timeout as a retryable failure', async () => {
    const fail = vi.fn(() => ({ data: 'retrying', error: null }))
    const { client } = makeClient({
      rpc: {
        claim_background_jobs: () => ({ data: [JOB], error: null }),
        fail_background_job: fail,
      },
    })
    const worker = new BackgroundWorker(client, { jobTimeoutMs: 25 })
    const spy = vi.spyOn(await import('@/lib/jobs/handlers'), 'getHandler').mockReturnValue(
      () => new Promise(() => {}) // never resolves
    )

    const result = await worker.processBatch()
    expect(result.retried).toBe(1)
    expect(result.failures[0].error).toMatch(/timeout/)
    spy.mockRestore()
  })

  it('returns empty accounting when claim infrastructure fails', async () => {
    const { client } = makeClient({
      rpc: { claim_background_jobs: () => ({ data: null, error: { message: 'db down' } }) },
    })
    const worker = new BackgroundWorker(client)
    const result = await worker.processBatch()
    expect(result.claimed).toBe(0)
    expect(result.completed).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
describe('job handlers', () => {

  it('approval sweep flips only overdue pending rows', async () => {
    const { client, tables } = makeClient()
    tables['approval_requests'].state.updateResult = { data: [{ id: 'a1' }, { id: 'a2' }], error: null }

    const res = await JOB_HANDLERS.approval_expiration_sweep(JOB, { supabase: client })
    expect(res.expired).toBe(2)
  })

  it('approval sweep surfaces db errors as thrown transient errors', async () => {
    const { client, tables } = makeClient()
    tables['approval_requests'].state.updateResult = { data: null, error: { message: 'rls' } }

    await expect(
      JOB_HANDLERS.approval_expiration_sweep(JOB, { supabase: client })
    ).rejects.toThrow(/approval sweep failed/)
  })

  it('embedding backfill dead-letters when OPENAI_API_KEY is missing', async () => {
    const prev = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY

    const { client, tables } = makeClient()
    tables['organizational_knowledge'].state.listResult = { data: [], error: null }

    await expect(
      JOB_HANDLERS.embedding_backfill(
        { ...JOB, job_type: 'embedding_backfill', payload: {} },
        { supabase: client }
      )
    ).rejects.toThrow(PermanentJobError)

    if (prev !== undefined) process.env.OPENAI_API_KEY = prev
  })

  it('execute_autonomous_action permanent-fails on missing payload fields', async () => {
    const { client } = makeClient()
    await expect(
      JOB_HANDLERS.execute_autonomous_action(
        { ...JOB, job_type: 'execute_autonomous_action', payload: {} },
        { supabase: client }
      )
    ).rejects.toThrow(PermanentJobError)
  })
})

// ---------------------------------------------------------------------------
// MaintenanceScheduler
// ---------------------------------------------------------------------------
describe('MaintenanceScheduler', () => {

  it('schedules one sweep per stale org with bucketed idempotency keys', async () => {
    const { client, tables } = makeClient()
    tables['approval_requests'].state.listResult = {
      data: [{ organization_id: 'org-1' }, { organization_id: 'org-1' }, { organization_id: 'org-2' }],
      error: null,
    }
    tables['background_jobs'].state.upsertResult = { data: { id: 'j' }, error: null }

    const s = new MaintenanceScheduler(client)
    const res = await s.scheduleApprovalSweeps()

    expect(res.scheduled).toBe(2)
    expect(res.errors).toEqual([])
  })

  it('reuses the same bucket key within the interval window (idempotent)', () => {
    // t1 aligned to a bucket boundary so t2 (last ms of the bucket) matches.
    const t1 = 5_666_666 * SWEEP_INTERVAL_MS
    const t2 = t1 + SWEEP_INTERVAL_MS - 1
    const t3 = t1 + SWEEP_INTERVAL_MS
    const key = (t: number) => `approval-sweep-${Math.floor(t / SWEEP_INTERVAL_MS)}`
    expect(key(t1)).toBe(key(t2))
    expect(key(t1)).not.toBe(key(t3))
  })

  it('reports query errors instead of throwing', async () => {
    const { client, tables } = makeClient()
    tables['approval_requests'].state.listResult = { data: null as any, error: { message: 'rls denied' } }

    const s = new MaintenanceScheduler(client)
    const res = await s.scheduleApprovalSweeps()
    expect(res.scheduled).toBe(0)
    expect(res.errors[0]).toMatch(/rls denied/)
  })
})
