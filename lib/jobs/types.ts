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
