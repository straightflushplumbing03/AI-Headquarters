/**
 * AI Authority Engine -- query runner.
 *
 * Executes one monitored query against one engine, end to end:
 *
 *   budget gate -> atomic budget hold -> idempotent run row -> adapter call
 *   -> persist RAW answer -> settle or release the hold -> record run outcome
 *
 * FAILURE PHILOSOPHY
 *
 * A monitoring sweep must survive a provider outage without losing anything and
 * without spending money on nothing. Therefore:
 *   - a skipped call (no credential, unsupported surface, budget) settles the
 *     hold to zero and records an explicit `skipped` run with a reason;
 *   - a failed call (timeout, rate limit, auth) releases the hold and records a
 *     `failed` run with the provider's error, so the job can retry later;
 *   - a success persists the raw text BEFORE any parsing, so the answer cannot
 *     be lost by a later parse failure;
 *   - a settle/release failure is logged loudly and never swallowed, because a
 *     wrong ledger is worse than a failed sweep.
 *
 * Nothing here fabricates a response. An engine that cannot be reached produces
 * a recorded failure, not an empty success.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { BudgetReservationService } from '@/lib/sprint3/budget-reservation'
import { EngineAdapterRegistry } from './adapters/base'
import { estimateUpperBoundCost } from './pricing'
import { AuthorityBudgetService } from './cost-control'
import { runKeyFor } from './query-normalizer'
import { AuthorityStore } from './store'
import type { AuthorityEngine, AuthorityQuery, AuthorityQueryRun } from './types'

export interface QueryRunOutcome {
  runId: string | null
  queryId: string
  engineKey: string
  status: 'completed' | 'failed' | 'skipped'
  reason?: string
  latencyMs: number
  responseId?: string | null
}

export interface QueryRunnerOptions {
  /**
   * Assumed token counts for the pre-call cost hold. The hold must be
   * conservative (never under-estimate) because the settlement is clamped to it.
   */
  assumedInputTokens?: number
  assumedOutputTokens?: number
  /** Overrides the time source; used by tests for deterministic run keys. */
  now?: Date
}

export class AuthorityQueryRunner {
  private store: AuthorityStore
  private budgets: AuthorityBudgetService
  private reservations: BudgetReservationService

  constructor(supabase: SupabaseClient) {
    this.store = new AuthorityStore(supabase)
    this.budgets = new AuthorityBudgetService(supabase)
    this.reservations = new BudgetReservationService(supabase)
  }

  /**
   * Run one query on one engine.
   *
   * Returns an outcome rather than throwing for provider-level problems, so a
   * batch can continue past a single bad engine. Infrastructure problems (a run
   * row that cannot be written) DO throw, so the job is retried.
   */
  async runQuery(params: {
    organizationId: string
    query: AuthorityQuery
    engine: AuthorityEngine
    options?: QueryRunnerOptions
  }): Promise<QueryRunOutcome> {
    const { organizationId, query, engine } = params
    const now = params.options?.now ?? new Date()

    const adapter = EngineAdapterRegistry.get(engine.key)
    if (!adapter) {
      return {
        runId: null,
        queryId: query.id,
        engineKey: engine.key,
        status: 'skipped',
        reason: `no adapter registered for engine '${engine.key}'`,
        latencyMs: 0,
      }
    }

    const model = adapter.model()
    const holdAmount = estimateUpperBoundCost(
      engine.key,
      model,
      params.options?.assumedInputTokens ?? 800,
      params.options?.assumedOutputTokens ?? 1200
    )

    // --------------------------------------------------------------------
    // 1. Capability gate. An unsupported or unconfigured surface is a
    //    recorded skip, never a fabricated result and never a cost.
    // --------------------------------------------------------------------
    const capability = adapter.capability()
    if (capability !== 'supported') {
      await this.store.syncEngineCapability(organizationId, engine.key, capability, model)
      return this.recordSkip({
        organizationId,
        query,
        engine,
        runKey: runKeyFor(query.normalized_text, engine.key, now),
        reason:
          capability === 'unsupported'
            ? `${engine.display_name} exposes no authorized monitoring API`
            : `${engine.display_name} adapter is not configured (missing ${engine.credential_env_var})`,
        now,
      })
    }
    // Keep stored state truthful as credentials appear/disappear.
    if (engine.capability !== 'supported') {
      await this.store.syncEngineCapability(organizationId, engine.key, 'supported', model)
    }

    // --------------------------------------------------------------------
    // 2. Budget gate (volume + cost + kill switches).
    // --------------------------------------------------------------------
    const decision = await this.budgets.authorize({
      organizationId,
      estimatedQueryCost: holdAmount,
      importance: query.importance,
    })
    if (!decision.allowed) {
      return this.recordSkip({
        organizationId,
        query,
        engine,
        runKey: runKeyFor(query.normalized_text, engine.key, now),
        reason: decision.reason,
        now,
      })
    }

    // --------------------------------------------------------------------
    // 3. Idempotent run row, created BEFORE the external call.
    //    If the call times out after the provider billed us, we still have a
    //    record to reconcile.
    // --------------------------------------------------------------------
    const runKey = runKeyFor(query.normalized_text, engine.key, now)
    const { run, created } = await this.store.ensureQueryRun({
      organizationId,
      queryId: query.id,
      engineId: engine.id,
      marketId: query.market_id,
      runKey,
      estimatedCost: holdAmount,
    })

    if (!created) {
      // Same query, same engine, same day: already attempted. Do not re-spend.
      return {
        runId: run.id,
        queryId: query.id,
        engineKey: engine.key,
        status: run.status === 'completed' ? 'completed' : 'skipped',
        reason: `already attempted today (status: ${run.status})`,
        latencyMs: run.latency_ms ?? 0,
        responseId: null,
      }
    }

    await this.store.updateQueryRun(organizationId, run.id, {
      status: 'running',
      started_at: new Date().toISOString(),
    })

    // --------------------------------------------------------------------
    // 4. Atomic budget hold (reuses the sprint-3 ledger).
    // --------------------------------------------------------------------
    let reservationId: string | null = null
    try {
      const reserved = await this.reservations.reserve({
        organizationId,
        amount: holdAmount,
        actionIdempotencyKey: `authority-run:${run.id}`,
        reference: `authority_query_run:${run.id}`,
      })
      reservationId = reserved.reservationId
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.store.updateQueryRun(organizationId, run.id, {
        status: 'skipped',
        skip_reason: `budget hold refused: ${message}`.slice(0, 500),
        completed_at: new Date().toISOString(),
      })
      return {
        runId: run.id,
        queryId: query.id,
        engineKey: engine.key,
        status: 'skipped',
        reason: `budget hold refused: ${message}`,
        latencyMs: 0,
      }
    }

    // --------------------------------------------------------------------
    // 5. The external call.
    // --------------------------------------------------------------------
    let result
    try {
      // Context is intentionally NOT passed to the adapter: the query text
      // already names the city and service, and priming the adapter with extra
      // context would change what is being measured.
      result = await adapter.executeQuery({ query: query.raw_text })
    } catch (error) {
      // The adapter contract says it should not throw; if it does, treat it as
      // a provider failure and release the hold rather than leaking budget.
      const message = error instanceof Error ? error.message : String(error)
      await this.releaseQuietly(reservationId, organizationId, run.id)
      await this.store.updateQueryRun(organizationId, run.id, {
        status: 'failed',
        error_message: message.slice(0, 500),
        completed_at: new Date().toISOString(),
        actual_cost: 0,
      })
      await this.store.markEngineError(organizationId, engine.key, message)
      return {
        runId: run.id,
        queryId: query.id,
        engineKey: engine.key,
        status: 'failed',
        reason: message,
        latencyMs: 0,
      }
    }

    // --------------------------------------------------------------------
    // 6. Settle or release the hold based on the real outcome.
    // --------------------------------------------------------------------
    if (result.ok) {
      const settled = result.actualCost > 0 ? result.actualCost : holdAmount
      try {
        await this.reservations.settle(reservationId, organizationId, settled)
      } catch (error) {
        console.error(
          `[authority] settle failed for run ${run.id}: ${error instanceof Error ? error.message : error}`
        )
      }

      await this.store.updateQueryRun(organizationId, run.id, {
        status: 'completed',
        model: result.model,
        latency_ms: result.latencyMs,
        actual_cost: settled,
        tokens_input: result.tokensInput,
        tokens_output: result.tokensOutput,
        error_message: null,
        completed_at: new Date().toISOString(),
      })

      // Persist the RAW answer immediately. Parsing is a separate step so a
      // parser bug can never lose an answer we already paid for.
      const response = await this.store.insertRawResponse({
        organizationId,
        runId: run.id,
        queryId: query.id,
        engineId: engine.id,
        marketId: query.market_id,
        engineKey: engine.key,
        model: result.model,
        rawText: result.text,
      })

      await this.store.touchQueryRunStats(organizationId, query.id, query.run_count)
      await this.store.markEngineError(organizationId, engine.key, null)
      await this.store.logAudit({
        organizationId,
        userId: null,
        action: 'ai_authority.query_run_completed',
        resource: `authority_query_run:${run.id}`,
        details: `Query executed on ${engine.display_name}`,
        metadata: {
          engineKey: engine.key,
          queryId: query.id,
          marketId: query.market_id,
          latencyMs: result.latencyMs,
          cost: settled,
        },
      })

      return {
        runId: run.id,
        queryId: query.id,
        engineKey: engine.key,
        status: 'completed',
        latencyMs: result.latencyMs,
        responseId: response?.id ?? null,
      }
    }

    // Not ok: a skipped call refunds the hold; a real failure also refunds and
    // is retried by the job queue at the run level (a new day => a new run key).
    await this.releaseQuietly(reservationId, organizationId, run.id)

    const isSkip = result.skipped === true
    await this.store.updateQueryRun(organizationId, run.id, {
      status: isSkip ? 'skipped' : 'failed',
      skip_reason: isSkip ? (result.skipReason ?? result.error ?? 'skipped').slice(0, 500) : undefined,
      error_message: isSkip ? undefined : (result.error ?? 'unknown provider error').slice(0, 500),
      latency_ms: result.latencyMs,
      actual_cost: 0,
      completed_at: new Date().toISOString(),
    })

    if (!isSkip) {
      await this.store.markEngineError(organizationId, engine.key, result.error ?? null)
    }

    return {
      runId: run.id,
      queryId: query.id,
      engineKey: engine.key,
      status: isSkip ? 'skipped' : 'failed',
      reason: result.error,
      latencyMs: result.latencyMs,
    }
  }

  private async recordSkip(params: {
    organizationId: string
    query: AuthorityQuery
    engine: AuthorityEngine
    runKey: string
    reason: string
    now: Date
  }): Promise<QueryRunOutcome> {
    const { organizationId, query, engine } = params

    try {
      const { run, created } = await this.store.ensureQueryRun({
        organizationId,
        queryId: query.id,
        engineId: engine.id,
        marketId: query.market_id,
        runKey: params.runKey,
        estimatedCost: 0,
      })

      if (created) {
        await this.store.updateQueryRun(organizationId, run.id, {
          status: 'skipped',
          skip_reason: params.reason.slice(0, 500),
          completed_at: new Date().toISOString(),
        })
      }

      return {
        runId: run.id,
        queryId: query.id,
        engineKey: engine.key,
        status: 'skipped',
        reason: params.reason,
        latencyMs: 0,
      }
    } catch (error) {
      // Skipping must not break the batch; surface it in the outcome instead.
      return {
        runId: null,
        queryId: query.id,
        engineKey: engine.key,
        status: 'skipped',
        reason: `${params.reason} (run row write failed: ${
          error instanceof Error ? error.message : 'unknown'
        })`,
        latencyMs: 0,
      }
    }
  }

  private async releaseQuietly(
    reservationId: string | null,
    organizationId: string,
    runId: string
  ): Promise<void> {
    if (!reservationId) return
    try {
      await this.reservations.release(reservationId, organizationId)
    } catch (error) {
      // The stale-hold reaper (budget_reconciliation_sweep) is the safety net,
      // so this is loud but not fatal.
      console.error(
        `[authority] release failed for run ${runId}: ${
          error instanceof Error ? error.message : error
        } (the budget reconciliation sweep will reap it)`
      )
    }
  }
}

/** Aggregate accounting for a monitoring sweep. */
export interface SweepSummary {
  attempted: number
  completed: number
  failed: number
  skipped: number
  engines: Record<string, { completed: number; failed: number; skipped: number }>
}

export function summarizeOutcomes(outcomes: QueryRunOutcome[]): SweepSummary {
  const summary: SweepSummary = {
    attempted: outcomes.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    engines: {},
  }

  for (const outcome of outcomes) {
    summary[outcome.status] += 1
    const bucket = (summary.engines[outcome.engineKey] ??= { completed: 0, failed: 0, skipped: 0 })
    bucket[outcome.status] += 1
  }

  return summary
}

/** Narrow helper for rows the store returns as loosely typed. */
export function asQueryRow(row: unknown): AuthorityQuery {
  return row as AuthorityQuery
}

export function asRunRow(row: unknown): AuthorityQueryRun {
  return row as AuthorityQueryRun
}