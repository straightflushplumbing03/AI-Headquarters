/**
 * Sprint 5.3 P1: Recurring maintenance jobs
 *
 * The sweeper endpoint (/api/jobs/tick) enqueues these on a cadence. Each is
 * idempotent per window (the idempotency key contains the time bucket), so
 * overlapping ticks or duplicate cron firings cannot double-schedule work.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BackgroundJobQueue } from './queue'

/** Milliseconds per bucket; one job per bucket per org. */
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Budget reconciliation cadence + stale-hold age. A hold older than this is
 * orphaned (the engine releases in-line within seconds); reaping it restores
 * the org's available budget.
 */
export const BUDGET_RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000 // hourly
export const MAX_RESERVATION_AGE_SECONDS = 60 * 60 // 1 hour

function bucketKey(prefix: string, intervalMs: number, now = Date.now()): string {
  const bucket = Math.floor(now / intervalMs)
  return `${prefix}-${bucket}`
}

export class MaintenanceScheduler {
  private queue: BackgroundJobQueue

  constructor(private supabase: SupabaseClient) {
    this.queue = new BackgroundJobQueue(supabase)
  }

  /**
   * Enqueue the approval-expiration sweep for every org that has pending
   * approvals with a deadline in the past. Orgs are discovered server-side —
   * the caller's identity never determines scope.
   */
  async scheduleApprovalSweeps(now = new Date()): Promise<{ scheduled: number; errors: string[] }> {
    const errors: string[] = []
    let scheduled = 0

    // Orgs with at least one pending approval already past deadline.
    const { data: stale, error } = await this.supabase
      .from('approval_requests')
      .select('organization_id')
      .eq('approval_status', 'pending')
      .lt('response_deadline', now.toISOString())

    if (error) {
      return { scheduled: 0, errors: [`query failed: ${error.message}`] }
    }

    const orgIds = [...new Set((stale ?? []).map((r) => r.organization_id))]

    for (const organizationId of orgIds) {
      const res = await this.queue.enqueue({
        jobType: 'approval_expiration_sweep',
        organizationId,
        idempotencyKey: bucketKey('approval-sweep', SWEEP_INTERVAL_MS, now.getTime()),
      })
      if (res.error) errors.push(`${organizationId}: ${res.error}`)
      else scheduled++
    }

    return { scheduled, errors }
  }

  /**
   * Enqueue embedding backfills for orgs with pending knowledge rows.
   */
  async scheduleEmbeddingBackfills(now = new Date()): Promise<{ scheduled: number; errors: string[] }> {
    const errors: string[] = []
    let scheduled = 0

    const { data: pending, error } = await this.supabase
      .from('organizational_knowledge')
      .select('organization_id')
      .eq('embeddings_pending', true)
      .limit(500)

    if (error) {
      return { scheduled: 0, errors: [`query failed: ${error.message}`] }
    }

    const orgIds = [...new Set((pending ?? []).map((r) => r.organization_id))]

    for (const organizationId of orgIds) {
      const res = await this.queue.enqueue({
        jobType: 'embedding_backfill',
        organizationId,
        idempotencyKey: bucketKey('embedding-backfill', SWEEP_INTERVAL_MS, now.getTime()),
      })
      if (res.error) errors.push(`${organizationId}: ${res.error}`)
      else scheduled++
    }

    return { scheduled, errors }
  }

  /**
   * Enqueue budget reconciliation sweeps for every org that HAS an
   * ai_usage_limits row (budget-carrying orgs). Orgs are discovered
   * server-side; the caller's identity never determines scope. The sweep is
   * a safety net: normal executions release/settle holds in-line.
   */
  async scheduleBudgetReconciliation(now = new Date()): Promise<{ scheduled: number; errors: string[] }> {
    const errors: string[] = []
    let scheduled = 0

    const { data: orgs, error } = await this.supabase
      .from('ai_usage_limits')
      .select('organization_id')
      .limit(500)

    if (error) {
      return { scheduled: 0, errors: [`query failed: ${error.message}`] }
    }

    const orgIds = [...new Set((orgs ?? []).map((r) => r.organization_id))]

    for (const organizationId of orgIds) {
      const res = await this.queue.enqueue({
        jobType: 'budget_reconciliation_sweep',
        organizationId,
        idempotencyKey: bucketKey(
          'budget-reconciliation',
          BUDGET_RECONCILIATION_INTERVAL_MS,
          now.getTime()
        ),
        payload: { maxReservationAgeSeconds: MAX_RESERVATION_AGE_SECONDS },
      })
      if (res.error) errors.push(`${organizationId}: ${res.error}`)
      else scheduled++
    }

    return { scheduled, errors }
  }
}
