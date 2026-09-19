/**
 * Sprint 5.3 P1: Durable background job types
 *
 * Mirrors supabase/migrations/015_sprint53_background_jobs.sql.
 * Payload/result shapes for every registered job type.
 */

export type BackgroundJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'dead'

export type BackgroundJobType =
  | 'approval_expiration_sweep'
  | 'embedding_backfill'
  | 'execute_autonomous_action'
  | 'budget_reconciliation_sweep'
  // AI Authority Engine (see lib/authority/*)
  | 'authority_query_execution'
  | 'authority_response_parsing'
  | 'authority_competitor_monitor'
  | 'authority_website_crawl'
  | 'authority_search_console_sync'
  | 'authority_gbp_sync'
  | 'authority_scoring'
  | 'authority_recommendation_generation'
  | 'authority_experiment_evaluation'
  | 'authority_data_quality_sweep'

export interface ApprovalSweepPayload {
  // Expire every pending approval whose response_deadline has passed for the
  // org. No additional params needed; organization_id scopes the sweep.
}

export interface EmbeddingBackfillPayload {
  /** Limit rows processed per attempt (bounded work per job run). */
  batchSize?: number
}

export interface ExecuteActionPayload {
  /** autonomous_actions.id */
  actionId: string
  /** autonomous_actions.idempotency_key (already claimed row) */
  idempotencyKey: string
}

export interface BudgetReconciliationPayload {
  /** Release open budget holds older than this many seconds. */
  maxReservationAgeSeconds: number
}

export type BackgroundJobPayload =
  | ApprovalSweepPayload
  | EmbeddingBackfillPayload
  | ExecuteActionPayload
  | BudgetReconciliationPayload
  | AuthorityQueryExecutionPayload
  | AuthorityResponseParsingPayload
  | AuthorityCompetitorMonitorPayload
  | AuthorityWebsiteCrawlPayload
  | AuthorityScoringPayload
  | AuthorityRecommendationGenerationPayload
  | AuthorityExperimentEvaluationPayload
  | AuthorityDataQualityPayload
  | AuthorityIntegrationSyncPayload

/**
 * AI Authority job payload shapes.
 *
 * Re-declared here (rather than imported from lib/authority/types) so the job
 * layer stays decoupled from the authority domain, mirroring how the existing
 * payloads are declared. The authority module's own payload interfaces are
 * structurally identical.
 */
export interface AuthorityQueryExecutionPayload {
  limit?: number
  marketId?: string
  engineKey?: string
}

export interface AuthorityResponseParsingPayload {
  limit?: number
  reparse?: boolean
}

export interface AuthorityCompetitorMonitorPayload {
  windowDays?: number
  snapshotDate?: string
}

export interface AuthorityWebsiteCrawlPayload {
  siteOrigin?: string
  maxPages?: number
  rateLimitMs?: number
}

export interface AuthorityScoringPayload {
  windowDays?: number
  marketId?: string
}

export interface AuthorityRecommendationGenerationPayload {
  limit?: number
  marketId?: string
  rescore?: boolean
}

export interface AuthorityExperimentEvaluationPayload {
  experimentId?: string
}

export interface AuthorityDataQualityPayload {
  limit?: number
}

export interface AuthorityIntegrationSyncPayload {
  startDate?: string
  endDate?: string
  days?: number
}

export interface BackgroundJobRow {
  id: string
  organization_id: string
  job_type: BackgroundJobType
  payload: BackgroundJobPayload
  status: BackgroundJobStatus
  attempts: number
  max_attempts: number
  last_error: string | null
  error_history: Array<{ attempt: number; error: string; at: string }>
  scheduled_at: string
  started_at: string | null
  completed_at: string | null
  lease_expires_at: string | null
  idempotency_key: string
  result: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

/** Row returned by claim_background_jobs(). */
export interface ClaimedJob {
  id: string
  organization_id: string
  job_type: BackgroundJobType
  payload: BackgroundJobPayload
  attempts: number
  max_attempts: number
  idempotency_key: string
}

export const JOB_DEFAULTS = {
  /** Max attempts before dead-letter (matches migration CHECK bound). */
  maxAttempts: 5,
  /** Lease length a worker holds a claimed job. */
  leaseSeconds: 300,
  /** Rows per claim batch. */
  batchSize: 5,
  /** Base for exponential backoff: 30s -> 60s -> 120s -> 240s -> 480s. */
  backoffBaseSeconds: 30,
} as const
