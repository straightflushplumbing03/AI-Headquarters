/**
 * Sprint 5.3 P1: Durable background job queue (Postgres/Supabase)
 *
 * Guarantees:
 * - DURABLE: state lives in the background_jobs table; any process (or none)
 *   can be running without losing work. Survives refresh/restart/close.
 * - ENQUEUE-ONCE: duplicate (org, type, idempotency_key) enqueues are no-ops.
 * - ATOMIC CLAIM: claim_background_jobs() uses FOR UPDATE SKIP LOCKED so two
 *   workers can never run the same job.
 * - SAFE RETRY: transient failures reschedule with exponential backoff;
 *   permanent failures dead-letter immediately; exhausted retries dead-letter.
 * - STALE-LEASE RECOVERY: a crashed worker's job is re-claimed after the lease
 *   expires and eventually dead-letters if it keeps crashing.
 * - KILL SWITCH: claims fail-closed when the global kill switch or the org's
 *   ai_usage_limits.paused flag is active (enforced in SQL).
 * - DEAD LETTER: dead jobs are retained and requeueable via
 *   requeue_dead_background_job(); nothing is silently dropped.
 *
 * SECURITY:
 * - Every function takes a SupabaseClient. For user-triggered enqueues pass
 *   the user-scoped client (RLS applies). For worker processing, the worker
 *   endpoint authenticates the caller first and passes its own scoped client —
 *   the job's organization_id is never trusted from the request body.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { JOB_DEFAULTS, type BackgroundJobRow, type BackgroundJobType, type ClaimedJob } from './types'

export interface EnqueueOptions {
  jobType: BackgroundJobType
  organizationId: string
  idempotencyKey: string
  payload?: Record<string, unknown>
  /** Delay before the job is eligible to run. */
  delaySeconds?: number
  maxAttempts?: number
  createdBy?: string
}

export interface EnqueueResult {
  jobId: string | null
  /** true when an identical job already existed (idempotent no-op). */
  deduplicated: boolean
  error?: string
}

export class BackgroundJobQueue {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Enqueue a job. Idempotent per (organization_id, job_type, idempotency_key):
   * re-enqueueing an existing job returns its id with deduplicated=true and
   * never schedules duplicate execution.
   */
  async enqueue(opts: EnqueueOptions): Promise<EnqueueResult> {
    if (!opts.idempotencyKey || !opts.organizationId || !opts.jobType) {
      return { jobId: null, deduplicated: false, error: 'jobType, organizationId and idempotencyKey are required' }
    }

    const scheduledAt = new Date(
      Date.now() + (opts.delaySeconds ?? 0) * 1000
    ).toISOString()

    const { data, error } = await this.supabase
      .from('background_jobs')
      .upsert(
        {
          organization_id: opts.organizationId,
          job_type: opts.jobType,
          idempotency_key: opts.idempotencyKey,
          payload: opts.payload ?? {},
          max_attempts: opts.maxAttempts ?? JOB_DEFAULTS.maxAttempts,
          scheduled_at: scheduledAt,
          status: 'pending',
          created_by: opts.createdBy ?? null,
        },
        { onConflict: 'organization_id,job_type,idempotency_key', ignoreDuplicates: true }
      )
      .select('id')

    if (error) {
      // ignoreDuplicates suppresses the unique violation; other errors surface.
      return { jobId: null, deduplicated: false, error: error.message }
    }

    // S53-APP-INTEGRATION fix: with ignoreDuplicates, PostgREST returns ZERO
    // rows when the conflict was swallowed. .single() on that result raises
    // PGRST116, so every duplicate enqueue used to surface as an error.
    // Treat an empty result as the deduplicated path and look the job up.
    if (data && data.length > 0 && data[0].id) {
      return { jobId: data[0].id, deduplicated: false }
    }

    // No row returned + no error => conflict was ignored (job already existed).
    const { data: existing } = await this.supabase
      .from('background_jobs')
      .select('id')
      .eq('organization_id', opts.organizationId)
      .eq('job_type', opts.jobType)
      .eq('idempotency_key', opts.idempotencyKey)
      .single()

    return { jobId: existing?.id ?? null, deduplicated: true }
  }

  /**
   * Atomically claim the next batch of runnable jobs. Delegates lease and
   * concurrency control to claim_background_jobs() in Postgres.
   */
  async claim(workerId: string, batchSize: number = JOB_DEFAULTS.batchSize): Promise<ClaimedJob[]> {
    const { data, error } = await this.supabase.rpc('claim_background_jobs', {
      p_worker_id: workerId,
      p_batch_size: batchSize,
      p_lease_seconds: JOB_DEFAULTS.leaseSeconds,
    })

    if (error) {
      console.error('[jobs] claim failed:', error.message)
      return []
    }

    return (data ?? []) as ClaimedJob[]
  }

  async complete(jobId: string, organizationId: string, result?: Record<string, unknown>): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('complete_background_job', {
      p_job_id: jobId,
      p_organization_id: organizationId,
      p_result: result ?? null,
    })
    if (error) {
      console.error('[jobs] complete failed:', error.message)
      return false
    }
    return Boolean(data)
  }

  /**
   * Fail a job. Transient by default (retries with exponential backoff until
   * max_attempts); pass permanent=true to dead-letter immediately.
   */
  async fail(
    jobId: string,
    organizationId: string,
    errorMessage: string,
    opts?: { permanent?: boolean }
  ): Promise<'retrying' | 'dead' | 'noop'> {
    const { data, error } = await this.supabase.rpc('fail_background_job', {
      p_job_id: jobId,
      p_organization_id: organizationId,
      p_error: errorMessage,
      p_permanent: opts?.permanent ?? false,
      p_backoff_base_seconds: JOB_DEFAULTS.backoffBaseSeconds,
    })
    if (error) {
      console.error('[jobs] fail failed:', error.message)
      return 'noop'
    }
    return (data as 'retrying' | 'dead' | 'noop') ?? 'noop'
  }

  /** Operator action: give a dead-lettered job a fresh retry cycle. */
  async requeueDead(jobId: string, organizationId: string): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('requeue_dead_background_job', {
      p_job_id: jobId,
      p_organization_id: organizationId,
    })
    if (error) {
      console.error('[jobs] requeue failed:', error.message)
      return false
    }
    return Boolean(data)
  }

  /** Recent jobs for an org (ops visibility / UI). */
  async listJobs(organizationId: string, opts?: { status?: string; limit?: number }): Promise<BackgroundJobRow[]> {
    let query = this.supabase
      .from('background_jobs')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 50)

    if (opts?.status) {
      query = query.eq('status', opts.status)
    }

    const { data, error } = await query
    if (error) {
      console.error('[jobs] list failed:', error.message)
      return []
    }
    return (data ?? []) as BackgroundJobRow[]
  }
}
