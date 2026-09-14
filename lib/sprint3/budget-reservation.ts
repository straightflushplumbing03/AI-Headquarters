/**
 * Sprint 5.3 P2: Atomic budget reservation service.
 *
 * Wraps the Postgres RPCs from migrations 012 + 016 so budget authorization is
 * made ATOMICALLY IN THE DATABASE — never via read-modify-write in the
 * application:
 *
 *   reserve_budget_idempotent()    reserve a hold (idempotent per action key)
 *   settle_budget_clamped()        charge actual (clamped to the hold)
 *   release_budget()               failure path (idempotent, migration 012)
 *   release_stale_budget_reservations()  safety net for orphaned holds
 *
 * Error classification (fail-closed):
 *   PERMANENT: NO_BUDGET_ROW, INVALID_RESERVATION_KEY, INVALID_RESERVATION_AMOUNT
 *              INVALID_SETTLEMENT_AMOUNT, INVALID_REAPER_AGE
 *   TRANSIENT: BUDGET_EXCEEDED (another actor's hold may be released),
 *              KILL_SWITCH_ACTIVE (an operator may lift it), network errors
 *
 * SECURITY:
 *   - Pass the USER-SCOPED client for user-triggered executions (RLS applies;
 *     the org scope is re-derived server-side in the RPC via ai_usage_limits).
 *   - Pass the worker's client for background executions (the job's
 *     organization_id was derived from the claimed row, and the RPC itself
 *     re-checks org state fail-closed).
 *   - organization_id is ALWAYS bound into every RPC call; no client input
 *     ever widens the scope.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { logFinancial } from '@/lib/ai/financial-logger'
import type { FinancialLogContext } from '@/lib/ai/financial-logger'

/** Errors that will not change on retry — the job layer dead-letters them. */
export class PermanentBudgetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentBudgetError'
  }
}

const PERMANENT_PREFIXES = [
  'NO_BUDGET_ROW',
  'INVALID_RESERVATION_KEY',
  'INVALID_RESERVATION_AMOUNT',
  'INVALID_SETTLEMENT_AMOUNT',
  'INVALID_REAPER_AGE',
] as const

export function classifyBudgetError(message: string): 'permanent' | 'transient' {
  const permanent = PERMANENT_PREFIXES.some((p) => message.startsWith(p))
  return permanent ? 'permanent' : 'transient'
}

export interface ReserveBudgetInput {
  organizationId: string
  /** agents.id — optional; some system actions have no owning agent row. */
  agentId?: string | null
  taskId?: string | null
  /** Estimated cost to hold. 0 reserves nothing and returns null. */
  amount: number
  /**
   * The ACTION's idempotency key (autonomous_actions.idempotency_key). Ties
   * the hold to the action so retries/re-enqueues/duplicate ticks reuse the
   * same hold instead of double-reserving. Required.
   */
  actionIdempotencyKey: string
  reference?: string
}

export interface ReserveBudgetResult {
  /** Null when amount is 0 (no hold needed). */
  reservationId: string | null
  /** True when an existing hold for this action was reused (deduplicated). */
  deduplicated: boolean
}

export class BudgetReservationService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Atomically reserve `amount` against the org's monthly budget. Idempotent
   * per (organization_id, actionIdempotencyKey): a second call returns the
   * same reservation without creating a second hold.
   *
   * Throws PermanentBudgetError for non-retryable configuration problems;
   * throws Error (transient) for BUDGET_EXCEEDED / KILL_SWITCH_ACTIVE.
   */
  async reserve(input: ReserveBudgetInput): Promise<ReserveBudgetResult> {
    if (!input.actionIdempotencyKey) {
      throw new PermanentBudgetError(
        'INVALID_RESERVATION_KEY: actionIdempotencyKey is required for budget reservation'
      )
    }
    if (input.amount < 0) {
      throw new PermanentBudgetError(
        'INVALID_RESERVATION_AMOUNT: amount must be >= 0'
      )
    }
    // Zero-cost actions need no hold; fail-closed behavior is preserved by
    // still refusing to run when the org is paused (checked separately by the
    // engine's kill-switch gate before this call).
    if (input.amount === 0) {
      logFinancial({
        op: 'budget.reserve.success',
        ctx: this.ctx(input),
        amounts: { requested: 0 },
        extra: { zeroCost: true },
      })
      return { reservationId: null, deduplicated: false }
    }

    logFinancial({
      op: 'budget.reserve.start',
      ctx: this.ctx(input),
      amounts: { requested: input.amount },
    })

    const { data, error } = await this.supabase.rpc('reserve_budget_idempotent', {
      p_organization_id: input.organizationId,
      p_agent_id: input.agentId ?? null,
      p_task_id: input.taskId ?? null,
      p_amount: input.amount,
      p_action_idempotency_key: input.actionIdempotencyKey,
      p_reference: input.reference ?? null,
    })

    if (error) {
      const message = error.message || 'budget reservation failed'
      logFinancial({
        op: 'budget.reserve.rejected',
        ctx: this.ctx(input),
        amounts: { requested: input.amount },
        extra: { reason: message, errorType: classifyBudgetError(message) },
      })
      if (classifyBudgetError(message) === 'permanent') {
        throw new PermanentBudgetError(message)
      }
      // BUDGET_EXCEEDED / KILL_SWITCH_ACTIVE / network — transient.
      throw new Error(message)
    }

    if (!data) {
      // Fail-closed: a successful RPC that returns no id is unusable.
      logFinancial({
        op: 'budget.reserve.error',
        ctx: this.ctx(input),
        amounts: { requested: input.amount },
        extra: { reason: 'reservation RPC returned no reservation id' },
      })
      throw new Error('BUDGET_EXCEEDED: reservation RPC returned no reservation id')
    }

    logFinancial({
      op: 'budget.reserve.success',
      ctx: this.ctx(input),
      amounts: { requested: input.amount, reserved: input.amount },
      extra: { reservationId: String(data) },
    })

    return { reservationId: data as string, deduplicated: false }
  }

  private ctx(input: ReserveBudgetInput): FinancialLogContext {
    return {
      organizationId: input.organizationId,
      agentId: input.agentId,
      taskId: input.taskId,
      reservationId: null,
      // The caller builds the idempotency key (e.g. `exec:<taskId>`); use it
      // as the requestId AS-IS so traces join across execution + reserve.
      requestId: input.actionIdempotencyKey || null,
      actionId: input.reference || null,
    }
  }

  /**
   * Settle a reservation after successful execution. The DATABASE clamps the
   * charged amount to [0, reserved_amount], so a caller can never inflate
   * available budget. Idempotent: settling an already-settled reservation is
   * a no-op returning false.
   */
  async settle(
    reservationId: string | null,
    organizationId: string,
    actualAmount: number
  ): Promise<{ settled: boolean }> {
    const baseCtx: FinancialLogContext = {
      organizationId,
      reservationId,
      settlementId: reservationId,
    }
    if (!reservationId) return { settled: false }
    if (actualAmount < 0) {
      logFinancial({
        op: 'budget.settle.error',
        ctx: baseCtx,
        amounts: { actual: actualAmount },
        extra: { reason: 'INVALID_SETTLEMENT_AMOUNT' },
      })
      throw new PermanentBudgetError(
        'INVALID_SETTLEMENT_AMOUNT: actual amount must be >= 0'
      )
    }

    logFinancial({
      op: 'budget.settle.start',
      ctx: baseCtx,
      amounts: { actual: actualAmount },
    })

    const { data, error } = await this.supabase.rpc('settle_budget_clamped', {
      p_reservation_id: reservationId,
      p_organization_id: organizationId,
      p_actual_amount: actualAmount,
    })

    if (error) {
      const message = error.message || 'budget settlement failed'
      logFinancial({
        op: 'budget.settle.error',
        ctx: baseCtx,
        amounts: { actual: actualAmount },
        extra: { reason: message },
      })
      if (classifyBudgetError(message) === 'permanent') {
        throw new PermanentBudgetError(message)
      }
      throw new Error(message)
    }

    logFinancial({
      op: data ? 'budget.settle.success' : 'budget.settle.noop',
      ctx: baseCtx,
      amounts: { actual: actualAmount },
    })

    return { settled: Boolean(data) }
  }

  /**
   * Release a hold on failure. Idempotent (only 'reserved' rows release).
   * Release failures are logged, not thrown — the execution has already
   * failed, and the stale-hold reaper is the safety net for a failed release.
   */
  async release(
    reservationId: string | null,
    organizationId: string
  ): Promise<boolean> {
    if (!reservationId) return false

    const ctx: FinancialLogContext = { organizationId, reservationId }
    logFinancial({ op: 'budget.release.start', ctx })

    const { data, error } = await this.supabase.rpc('release_budget', {
      p_reservation_id: reservationId,
      p_organization_id: organizationId,
    })

    if (error) {
      logFinancial({
        op: 'budget.release.error',
        ctx,
        extra: { reason: error.message },
      })
      return false
    }
    logFinancial({
      op: data ? 'budget.release.success' : 'budget.release.noop',
      ctx,
    })
    return Boolean(data)
  }

  /**
   * Safety net: release every open hold older than maxAgeSeconds for this org
   * (crashed process between reserve and settle/release). The engine's
   * normal failure path releases promptly; this covers orphans.
   */
  async releaseStaleHolds(
    organizationId: string,
    maxAgeSeconds: number
  ): Promise<number> {
    // Client-side guard mirroring the SQL function's INVALID_REAPER_AGE
    // exception — fail-closed instead of silently reaping nothing.
    if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
      throw new PermanentBudgetError('INVALID_REAPER_AGE: max age must be positive')
    }

    const { data, error } = await this.supabase.rpc(
      'release_stale_budget_reservations',
      {
        p_organization_id: organizationId,
        p_max_age_seconds: maxAgeSeconds,
      }
    )

    if (error) {
      console.error(
        `[budget] stale-hold reaper failed for org ${organizationId}: ${error.message}`
      )
      return 0
    }
    return typeof data === 'number' ? data : 0
  }
}
