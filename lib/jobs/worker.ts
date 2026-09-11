/**
 * Sprint 5.3 P1: Background worker loop
 *
 * Drains claimed jobs through their handlers with full accounting:
 * - claim -> run handler -> complete | fail (transient => backoff retry,
 *   PermanentJobError => dead-letter)
 * - unexpected handler crashes are failures like any other (never swallowed)
 * - per-job timeout so a hung handler releases its lease rather than blocking
 *   the queue until the lease recovers it
 * - graceful stop: finishes the current batch, then exits
 *
 * The worker is intentionally transport-agnostic: it can be driven by
 *   * the /api/jobs/tick endpoint (cron, Supabase pg_cron, uptime pinger),
 *   * a long-running process (scripts/worker.ts), or
 *   * a test harness (unit tests drive processBatch directly).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BackgroundJobQueue } from './queue'
import { getHandler, PermanentJobError } from './handlers'
import { JOB_DEFAULTS, type ClaimedJob } from './types'

export interface WorkerOptions {
  batchSize?: number
  /** Hard per-job execution timeout in ms (lease is recovered after it). */
  jobTimeoutMs?: number
  /** Random id used for observability; generated when omitted. */
  workerId?: string
}

export interface BatchResult {
  workerId: string
  claimed: number
  completed: number
  retried: number
  deadLettered: number
  failures: Array<{ jobId: string; jobType: string; error: string; outcome: 'retrying' | 'dead' | 'noop' }>
}

function runWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`job timeout after ${ms}ms: ${label}`)),
      ms
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

export class BackgroundWorker {
  private queue: BackgroundJobQueue
  private stopping = false

  constructor(
    private supabase: SupabaseClient,
    private options: WorkerOptions = {}
  ) {
    this.queue = new BackgroundJobQueue(supabase)
  }

  /** Request a graceful stop after the in-flight batch finishes. */
  stop(): void {
    this.stopping = true
  }

  /**
   * Claim and process one batch. Returns accounting; never throws for job
   * failures (those are recorded via queue.fail), only for infrastructure
   * errors thrown by the claim call itself (also caught and reported).
   */
  async processBatch(): Promise<BatchResult> {
    const workerId = this.options.workerId ?? `worker-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const result: BatchResult = {
      workerId,
      claimed: 0,
      completed: 0,
      retried: 0,
      deadLettered: 0,
      failures: [],
    }

    let jobs: ClaimedJob[] = []
    try {
      jobs = await this.queue.claim(workerId, this.options.batchSize ?? Number(JOB_DEFAULTS.batchSize))
    } catch (err: any) {
      console.error('[worker] claim infrastructure error:', err?.message)
      return result
    }

    result.claimed = jobs.length

    for (const job of jobs) {
      if (this.stopping) break

      const handler = getHandler(job.job_type)
      if (!handler) {
        // Unknown type: permanent failure — retrying can never help.
        const outcome = await this.queue.fail(
          job.id,
          job.organization_id,
          `no handler registered for job type '${job.job_type}'`,
          { permanent: true }
        )
        result.deadLettered += outcome === 'dead' ? 1 : 0
        result.failures.push({ jobId: job.id, jobType: job.job_type, error: 'no handler', outcome })
        continue
      }

      try {
        const timeoutMs = this.options.jobTimeoutMs ?? 240_000
        const jobResult = await runWithTimeout(
          handler(job, { supabase: this.supabase }),
          timeoutMs,
          job.job_type
        )

        const ok = await this.queue.complete(job.id, job.organization_id, jobResult)
        if (ok) {
          result.completed++
        } else {
          // Job was recovered/failed elsewhere mid-run; the other state wins.
          console.warn(`[worker] job ${job.id} complete() returned false (state changed mid-run)`)
        }
      } catch (err: any) {
        const isPermanent = err instanceof PermanentJobError
        const message = err?.message || 'unknown job error'
        const outcome = await this.queue.fail(job.id, job.organization_id, message, {
          permanent: isPermanent,
        })

        if (outcome === 'dead') result.deadLettered++
        if (outcome === 'retrying') result.retried++
        result.failures.push({ jobId: job.id, jobType: job.job_type, error: message, outcome })
        console.error(`[worker] job ${job.id} (${job.job_type}) failed: ${message} -> ${outcome}`)
      }
    }

    return result
  }

  /**
   * Long-running drain loop (for a dedicated worker process). Poll interval
   * backs off when the queue is empty. Stop with .stop().
   */
  async runForever(pollIntervalMs = 5_000): Promise<void> {
    while (!this.stopping) {
      const batch = await this.processBatch()
      const idle = batch.claimed === 0
      await new Promise((r) => setTimeout(r, idle ? pollIntervalMs : 250))
    }
  }
}
