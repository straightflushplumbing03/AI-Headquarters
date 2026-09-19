/**
 * Sprint 5.3 P1: Recurring maintenance jobs
 *
 * The sweeper endpoint (/api/jobs/tick) enqueues these on a cadence. Each is
 * idempotent per window (the idempotency key contains the time bucket), so
 * overlapping ticks or duplicate cron firings cannot double-schedule work.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BackgroundJobQueue } from './queue'
import type { BackgroundJobType } from './types'

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

/**
 * AI Authority Engine scheduling cadences.
 *
 * Chosen so the cost of each stage matches how fast the underlying reality
 * changes. AI answers move day to day; the website changes rarely; the score
 * aggregates a window and only needs recalculating once a day.
 */
export const AUTHORITY_DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000
export const AUTHORITY_WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
export const AUTHORITY_MONTHLY_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

/** Bucket keys are date-based for daily+ cadences so a retried tick in the same
 * day reuses the same idempotency key and cannot double-schedule. */
function dateBucket(prefix: string, now: Date): string {
  return `${prefix}-${now.toISOString().slice(0, 10)}`
}

function monthBucket(prefix: string, now: Date): string {
  return `${prefix}-${now.toISOString().slice(0, 7)}`
}

/** Week bucket: ISO-ish week index so weekly jobs fire once per 7-day window. */
function weekBucket(prefix: string, now: Date): string {
  const week = Math.floor(now.getTime() / AUTHORITY_WEEKLY_INTERVAL_MS)
  return `${prefix}-${week}`
}

export class AuthorityScheduler {
  private queue: BackgroundJobQueue

  constructor(private supabase: SupabaseClient) {
    this.queue = new BackgroundJobQueue(supabase)
  }

  /** Orgs that have the authority engine seeded (markets exist). */
  private async authorityOrganizations(): Promise<string[]> {
    const { data } = await this.supabase.from('authority_markets').select('organization_id').limit(500)
    return [...new Set((data ?? []).map((r) => String(r.organization_id)))]
  }

  /**
   * DAILY: collect AI answers, parse them, monitor competitors.
   *
   * Query execution is bounded by the org's own budget, enforced inside the
   * runner, so a schedule that is too aggressive degrades rather than overspends.
   */
  async scheduleDaily(now = new Date()): Promise<{ scheduled: number; errors: string[] }> {
    const errors: string[] = []
    let scheduled = 0
    const orgIds = await this.authorityOrganizations()

    for (const organizationId of orgIds) {
      const jobs: Array<{ jobType: BackgroundJobType; key: string; payload: Record<string, unknown> }> = [
        {
          jobType: 'authority_query_execution',
          key: dateBucket('authority-query', now),
          payload: { limit: 40 },
        },
        {
          jobType: 'authority_response_parsing',
          key: dateBucket('authority-parse', now),
          payload: { limit: 150 },
        },
        {
          jobType: 'authority_competitor_monitor',
          key: dateBucket('authority-competitors', now),
          payload: { windowDays: 30 },
        },
      ]

      for (const spec of jobs) {
        const res = await this.queue.enqueue({
          jobType: spec.jobType,
          organizationId,
          idempotencyKey: spec.key,
          payload: spec.payload,
        })
        if (res.error) errors.push(`${organizationId}/${spec.jobType}: ${res.error}`)
        else scheduled++
      }
    }

    return { scheduled, errors }
  }

  /**
   * WEEKLY: rescore, then generate recommendations from the fresh scores.
   *
   * Ordering matters: recommendation generation is enqueued with a small delay
   * relative to scoring so it reads the new snapshots rather than the previous
   * week's. Both are still idempotent per week.
   */
  async scheduleWeekly(now = new Date()): Promise<{ scheduled: number; errors: string[] }> {
    const errors: string[] = []
    let scheduled = 0
    const orgIds = await this.authorityOrganizations()

    for (const organizationId of orgIds) {
      const jobs: Array<{ jobType: BackgroundJobType; key: string; payload: Record<string, unknown>; delaySeconds?: number }> = [
        {
          jobType: 'authority_scoring',
          key: weekBucket('authority-scoring', now),
          payload: { windowDays: 30 },
        },
        {
          jobType: 'authority_recommendation_generation',
          key: weekBucket('authority-recommendations', now),
          payload: { rescore: false },
          delaySeconds: 5 * 60,
        },
        {
          jobType: 'authority_experiment_evaluation',
          key: weekBucket('authority-experiments', now),
          payload: {},
        },
        {
          jobType: 'authority_data_quality_sweep',
          key: weekBucket('authority-data-quality', now),
          payload: {},
        },
      ]

      for (const spec of jobs) {
        const res = await this.queue.enqueue({
          jobType: spec.jobType,
          organizationId,
          idempotencyKey: spec.key,
          payload: spec.payload,
          delaySeconds: spec.delaySeconds,
        })
        if (res.error) errors.push(`${organizationId}/${spec.jobType}: ${res.error}`)
        else scheduled++
      }
    }

    return { scheduled, errors }
  }

  /**
   * MONTHLY: crawl the site and refresh external integrations.
   *
   * The crawl is monthly because site structure changes slowly and crawling is
   * the politest-but-most-expensive thing this system does to a third party.
   */
  async scheduleMonthly(now = new Date()): Promise<{ scheduled: number; errors: string[] }> {
    const errors: string[] = []
    let scheduled = 0
    const orgIds = await this.authorityOrganizations()

    for (const organizationId of orgIds) {
      const jobs: Array<{ jobType: BackgroundJobType; key: string; payload: Record<string, unknown> }> = [
        {
          jobType: 'authority_website_crawl',
          key: monthBucket('authority-crawl', now),
          payload: { maxPages: 150 },
        },
        {
          jobType: 'authority_search_console_sync',
          key: monthBucket('authority-gsc', now),
          payload: { days: 30 },
        },
        {
          jobType: 'authority_gbp_sync',
          key: monthBucket('authority-gbp', now),
          payload: { days: 30 },
        },
      ]

      for (const spec of jobs) {
        const res = await this.queue.enqueue({
          jobType: spec.jobType,
          organizationId,
          idempotencyKey: spec.key,
          payload: spec.payload,
        })
        if (res.error) errors.push(`${organizationId}/${spec.jobType}: ${res.error}`)
        else scheduled++
      }
    }

    return { scheduled, errors }
  }

  /** Run every authority cadence; used by the tick sweeper. */
  async scheduleAll(now = new Date()): Promise<{
    daily: number
    weekly: number
    monthly: number
    errors: string[]
  }> {
    const [daily, weekly, monthly] = await Promise.all([
      this.scheduleDaily(now),
      this.scheduleWeekly(now),
      this.scheduleMonthly(now),
    ])

    return {
      daily: daily.scheduled,
      weekly: weekly.scheduled,
      monthly: monthly.scheduled,
      errors: [...daily.errors, ...weekly.errors, ...monthly.errors],
    }
  }
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
