/**
 * Sprint 5.3 P1: Job handlers
 *
 * Each handler implements one registered job type. Handlers receive the
 * job's organization_id DERIVED FROM THE CLAIMED ROW (never from any client
 * request) and the client the worker authenticated with.
 *
 * Handler contract:
 * - Throw Error for transient failures (network, rate limit, lock contention):
 *   the queue retries with exponential backoff.
 * - Throw PermanentJobError for permanent failures (invalid payload, missing
 *   resource) to dead-letter immediately instead of burning retries.
 * - Never silently swallow errors.
 * - All DB access uses the worker's Supabase client so RLS still applies.
 */

import { EmbeddingService } from '@/lib/knowledge/embedding-service'
import { BudgetReservationService } from '@/lib/sprint3/budget-reservation'
import { logFinancial } from '@/lib/ai/financial-logger'
import { PermanentJobError } from './errors'
import type { JobContext, JobHandler } from './errors'
// AI Authority handlers are registered into THIS table, so there is exactly one
// job engine and one place that resolves a job type. The authority modules
// import PermanentJobError from './errors' (not from here), which is what keeps
// this a one-directional dependency.
import {
  authorityQueryExecution,
  authorityResponseParsing,
  authorityCompetitorMonitor,
  authorityWebsiteCrawl,
  authoritySearchConsoleSync,
  authorityGbpSync,
  authorityScoring,
  authorityRecommendationGeneration,
  authorityExperimentEvaluation,
  authorityDataQualitySweep,
} from '@/lib/authority/jobs'
import type {
  BackgroundJobType,
  BudgetReconciliationPayload,
  EmbeddingBackfillPayload,
  ExecuteActionPayload,
} from './types'

// Re-exported for backwards compatibility: existing call sites and tests import
// these from '@/lib/jobs/handlers'. The definitions live in './errors' so that
// domain handler modules can depend on them without importing this registry.
export { PermanentJobError }
export type { JobContext, JobHandler }

// ---------------------------------------------------------------------------
// 1. approval_expiration_sweep
//    Expires pending approvals past their response_deadline. Idempotent:
//    already-expired/cancelled rows are skipped by the status filter.
// ---------------------------------------------------------------------------
export const approvalExpirationSweep: JobHandler = async (job, ctx) => {
  const now = new Date().toISOString()

  // Only rows still pending AND past deadline are flipped; the update is
  // inherently idempotent (a second run matches zero rows).
  const { data, error } = await ctx.supabase
    .from('approval_requests')
    .update({ approval_status: 'expired' })
    .eq('organization_id', job.organization_id)
    .eq('approval_status', 'pending')
    .lt('response_deadline', now)
    .select('id')

  if (error) {
    throw new Error(`approval sweep failed: ${error.message}`)
  }

  const expired = data?.length ?? 0
  if (expired > 0) {
    // Structured trace: which approvals went from pending -> expired this run.
    logFinancial({
      op: 'approval.expired',
      ctx: { organizationId: job.organization_id },
      extra: { count: expired, approvalIds: (data ?? []).map((r) => r.id) },
    })
  }

  return { expired, sweptAt: now }
}

// ---------------------------------------------------------------------------
// 2. embedding_backfill
//    Processes pending/failed organizational_knowledge rows through the
//    Sprint 5.2 embedding service (bounded batch per run; re-enqueue for the
//    remainder keeps each job run short and retryable).
// ---------------------------------------------------------------------------
export const embeddingBackfill: JobHandler = async (job, ctx) => {
  const payload = (job.payload ?? {}) as EmbeddingBackfillPayload
  const batchSize = Math.min(Math.max(payload.batchSize ?? 25, 1), 100)

  const service = new EmbeddingService(ctx.supabase)
  const result = await service.processEmbeddings(job.organization_id, { batchSize })

  // OPENAI_API_KEY missing is a configuration error, not a data error: rows
  // stay pending, so retrying on a later attempt (or after config fix) works.
  const configErr = result.errors.find((e) => e.id === '*' && e.error.includes('OPENAI_API_KEY'))
  if (configErr && result.embedded === 0 && result.processed === 0) {
    throw new PermanentJobError(configErr.error)
  }

  if (result.failed > 0 && result.embedded === 0 && result.processed > 0) {
    // All rows failed this attempt — treat as transient to retry with backoff.
    throw new Error(`embedding backfill: ${result.failed} rows failed, 0 embedded`)
  }

  return {
    processed: result.processed,
    embedded: result.embedded,
    failed: result.failed,
    skipped: result.skipped,
    errors: result.errors.slice(0, 10),
  }
}

// ---------------------------------------------------------------------------
// 3. execute_autonomous_action
//    Drives an approved action through the Sprint 3 ActionExecutionEngine.
//    All Sprint 3 fail-closed checks (auth, org, permissions, risk, approval
//    validity, kill switches, budget, atomic idempotency) run again inside
//    the engine — the job layer adds durability, not a bypass.
// ---------------------------------------------------------------------------
export const executeAutonomousAction: JobHandler = async (job, ctx) => {
  const payload = (job.payload ?? {}) as ExecuteActionPayload
  if (!payload.actionId || !payload.idempotencyKey) {
    throw new PermanentJobError('execute_autonomous_action payload requires actionId and idempotencyKey')
  }

  // Load the action server-side; org scoping from the claimed row.
  const { data: action, error: actionErr } = await ctx.supabase
    .from('autonomous_actions')
    .select('*')
    .eq('id', payload.actionId)
    .eq('organization_id', job.organization_id)
    .single()

  if (actionErr || !action) {
    throw new PermanentJobError(`action ${payload.actionId} not found in org ${job.organization_id}`)
  }

  // Already executed successfully? Idempotent no-op.
  if (action.execution_status === 'completed') {
    return { skipped: true, reason: 'action already completed' }
  }

  // Import lazily to avoid a circular module graph at import time.
  const { ActionExecutionEngine } = await import('@/lib/sprint3/action-execution-engine')
  const engine = new ActionExecutionEngine(ctx.supabase)

  // The authoritative approval state comes from approval_requests (decision-
  // scoped). approval_required itself is derived: level_3/level_4 actions
  // always require an approval; the engine enforces this via checkRiskAuthorization.
  const { data: approval } = await ctx.supabase
    .from('approval_requests')
    .select('id, approval_status')
    .eq('decision_id', action.decision_id)
    .eq('organization_id', job.organization_id)
    .single()

  const result = await engine.executeAction({
    organizationId: job.organization_id,
    // Jobs run without an end-user session: system execution identity (the
    // queue already authenticated the tick caller via CRON_SECRET).
    userId: null as unknown as string,
    systemExecution: true,
    decisionId: action.decision_id ?? '',
    actionId: action.id,
    actionType: action.action_type,
    riskLevel: (action.risk_level ?? 'medium') as 'low' | 'medium' | 'high' | 'critical',
    authorizationLevel: (action.authorization_level ?? 'level_3') as 'level_1' | 'level_2' | 'level_3' | 'level_4',
    // Approval required when the authorization level demands it (level_3/4)
    // OR an approval row exists for this decision (one was requested).
    approvalRequired:
      ['level_3', 'level_4'].includes((action.authorization_level ?? 'level_3') as string) ||
      !!approval,
    title: action.title,
    description: action.description ?? '',
    estimatedCost: action.estimated_cost ?? 0,
    payload: action.payload ?? {},
    idempotencyKey: payload.idempotencyKey,
    operatingMode: 'autonomous',
  })

  if (!result.success) {
    throw new PermanentJobError(`action execution blocked: ${result.error ?? 'unknown'}`)
  }

  return { skipped: false, result: result.result ?? {} }
}

// ---------------------------------------------------------------------------
// 4. budget_reconciliation_sweep
//    Safety net for orphaned budget holds: releases reservations that were
//    taken but never settled/released (e.g. a process crash between reserve
//    and settle). The engine's normal failure path releases promptly; this
//    sweep bounds the damage window to the configured age. Idempotent: only
//    'reserved' rows are touched.
// ---------------------------------------------------------------------------
export const DEFAULT_MAX_RESERVATION_AGE_SECONDS = 60 * 60 // 1 hour

export const budgetReconciliationSweep: JobHandler = async (job, ctx) => {
  const payload = (job.payload ?? {}) as Partial<BudgetReconciliationPayload>
  const maxAge =
    typeof payload.maxReservationAgeSeconds === 'number' && payload.maxReservationAgeSeconds > 0
      ? payload.maxReservationAgeSeconds
      : DEFAULT_MAX_RESERVATION_AGE_SECONDS

  const service = new BudgetReservationService(ctx.supabase)
  const released = await service.releaseStaleHolds(job.organization_id, maxAge)

  if (released > 0) {
    // Visible signal that the safety net caught orphaned holds — this
    // usually means an execution path failed to release. Never silent.
    console.warn(
      `[jobs] budget_reconciliation_sweep: released ${released} orphaned hold(s) older than ${maxAge}s for org ${job.organization_id}`
    )
  }

  return { released, maxAgeSeconds: maxAge, sweptAt: new Date().toISOString() }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
// AI Authority Engine handlers live in lib/authority/jobs.ts so the domain
// stays self-contained; they are registered into this same dispatch table, so
// there is exactly ONE job engine and ONE place that resolves a job type.
export const JOB_HANDLERS: Record<BackgroundJobType, JobHandler> = {
  approval_expiration_sweep: approvalExpirationSweep,
  embedding_backfill: embeddingBackfill,
  execute_autonomous_action: executeAutonomousAction,
  budget_reconciliation_sweep: budgetReconciliationSweep,
  authority_query_execution: authorityQueryExecution,
  authority_response_parsing: authorityResponseParsing,
  authority_competitor_monitor: authorityCompetitorMonitor,
  authority_website_crawl: authorityWebsiteCrawl,
  authority_search_console_sync: authoritySearchConsoleSync,
  authority_gbp_sync: authorityGbpSync,
  authority_scoring: authorityScoring,
  authority_recommendation_generation: authorityRecommendationGeneration,
  authority_experiment_evaluation: authorityExperimentEvaluation,
  authority_data_quality_sweep: authorityDataQualitySweep,
}

export function getHandler(jobType: string): JobHandler | undefined {
  return JOB_HANDLERS[jobType as BackgroundJobType]
}
