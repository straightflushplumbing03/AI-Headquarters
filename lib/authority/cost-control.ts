/**
 * AI Authority Engine -- cost and volume control.
 *
 * AI monitoring is the kind of workload that quietly becomes expensive: query
 * generation is combinatorial, and a daily sweep across markets x engines
 * multiplies fast. This module bounds it in four independent ways, so no single
 * mistake can cause runaway spend:
 *
 *   1. per-query cost ceiling     -- reject a call whose ceiling is exceeded
 *   2. daily query limit          -- bound volume per day
 *   3. monthly query limit        -- bound volume per month
 *   4. org + global kill switches -- stop everything (reused, not reimplemented)
 *
 * The rules are FAIL-CLOSED: if the budget row cannot be read, monitoring stops
 * rather than proceeding unmeasured. Under constraint the engine degrades
 * GRACEFULLY by dropping the least important queries first, rather than
 * refusing everything.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthorityBudget, BudgetDecision } from './types'

/** Conservative defaults used when no budget row exists yet. */
export const DEFAULT_BUDGET: Omit<AuthorityBudget, 'organization_id' | 'created_at' | 'updated_at'> = {
  daily_query_limit: 200,
  monthly_query_limit: 4000,
  per_query_cost_ceiling: 0.25,
  monthly_cost_ceiling: 50,
  min_importance_when_constrained: 7,
  paused: false,
  pause_reason: null,
}

export interface BudgetUsage {
  queriesToday: number
  queriesThisMonth: number
  costThisMonth: number
}

export interface CostControlInput {
  organizationId: string
  budget: AuthorityBudget
  usage: BudgetUsage
  /** Estimated cost of the individual call about to be made. */
  estimatedQueryCost: number
  /** Importance of the query about to run (1-10). */
  importance: number
  /** Whether the org-level AI kill switch (ai_usage_limits.paused) is active. */
  organizationPaused: boolean
  /**
   * Global kill switch state.
   *
   * `null` means NOT DETERMINABLE with the current client. `system_flags` is
   * service-role only (migration 012 creates no client policies), so a
   * user-scoped client genuinely cannot read it. A null here is neither
   * "enabled" nor "safe": the AUTHORITATIVE global gate is
   * `claim_background_jobs()`, which refuses to hand out any job while the
   * switch is on. Because every external call in this subsystem runs as a
   * claimed background job, that SQL gate cannot be bypassed from TypeScript.
   */
  globalPaused: boolean | null
}

/**
 * Decide whether one monitoring call may proceed.
 *
 * Order matters: hard stops (kill switches, ceilings) are evaluated before
 * soft constraints, so a paused org never consumes a "grace" allowance.
 */
export function evaluateBudget(input: CostControlInput): BudgetDecision {
  const { budget, usage } = input

  if (input.globalPaused === true) {
    return { allowed: false, reason: 'Global kill switch is active; monitoring stopped' }
  }
  if (input.organizationPaused) {
    return { allowed: false, reason: 'Organization AI usage is paused; monitoring stopped' }
  }
  if (budget.paused) {
    return { allowed: false, reason: budget.pause_reason ?? 'AI Authority monitoring is paused' }
  }

  if (input.estimatedQueryCost > budget.per_query_cost_ceiling) {
    return {
      allowed: false,
      reason:
        `Estimated query cost ${input.estimatedQueryCost} exceeds the per-query ceiling ` +
        `${budget.per_query_cost_ceiling}`,
    }
  }

  if (usage.queriesToday >= budget.daily_query_limit) {
    return {
      allowed: false,
      reason: `Daily query limit reached (${usage.queriesToday}/${budget.daily_query_limit})`,
      retryAfterMs: msUntilUtcMidnight(),
    }
  }

  if (usage.queriesThisMonth >= budget.monthly_query_limit) {
    return {
      allowed: false,
      reason: `Monthly query limit reached (${usage.queriesThisMonth}/${budget.monthly_query_limit})`,
      retryAfterMs: msUntilMonthStart(),
    }
  }

  if (usage.costThisMonth + input.estimatedQueryCost > budget.monthly_cost_ceiling) {
    return {
      allowed: false,
      reason:
        `Monthly cost ceiling would be exceeded ` +
        `(${round6(usage.costThisMonth + input.estimatedQueryCost)} > ${budget.monthly_cost_ceiling})`,
      retryAfterMs: msUntilMonthStart(),
    }
  }

  // Soft constraint: when volume is running hot, only prioritize high-importance
  // queries rather than stopping entirely.
  const dailyUtilisation = budget.daily_query_limit > 0
    ? usage.queriesToday / budget.daily_query_limit
    : 1
  const monthlyUtilisation = budget.monthly_query_limit > 0
    ? usage.queriesThisMonth / budget.monthly_query_limit
    : 1

  if (dailyUtilisation >= 0.8 || monthlyUtilisation >= 0.8) {
    if (input.importance < budget.min_importance_when_constrained) {
      return {
        allowed: false,
        reason:
          `Budget utilisation high (daily ${(dailyUtilisation * 100).toFixed(0)}%, ` +
          `monthly ${(monthlyUtilisation * 100).toFixed(0)}%); deferring query of ` +
          `importance ${input.importance} (min ${budget.min_importance_when_constrained})`,
      }
    }
    return { allowed: true, tier: 'constrained' }
  }

  return { allowed: true, tier: 'normal' }
}

/**
 * Order queries so the highest business value is collected first when the
 * budget will not cover everything.
 */
export function prioritizeForBudget<T extends { importance: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.importance - a.importance)
}

export class AuthorityBudgetService {
  constructor(private supabase: SupabaseClient) {}

  async getBudget(organizationId: string): Promise<AuthorityBudget> {
    const { data, error } = await this.supabase
      .from('authority_budgets')
      .select('*')
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (error) {
      // Fail-closed: an unreadable budget must not become an unlimited budget.
      throw new Error(`getBudget failed: ${error.message}`)
    }
    if (!data) {
      return {
        organization_id: organizationId,
        ...DEFAULT_BUDGET,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    }
    return data as AuthorityBudget
  }

  /** Measure consumption from the actual run ledger, not a counter we maintain. */
  async getUsage(organizationId: string, now = new Date()): Promise<BudgetUsage> {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

    const [todayCount, monthCount, monthCost] = await Promise.all([
      this.countRuns(organizationId, dayStart),
      this.countRuns(organizationId, monthStart),
      this.sumRunCost(organizationId, monthStart),
    ])

    return { queriesToday: todayCount, queriesThisMonth: monthCount, costThisMonth: monthCost }
  }

  private async countRuns(organizationId: string, since: Date): Promise<number> {
    const { count, error } = await this.supabase
      .from('authority_query_runs')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .gte('created_at', since.toISOString())
      .in('status', ['completed', 'running', 'pending', 'failed'])

    if (error) {
      console.error(`[authority] countRuns failed: ${error.message}`)
      // Fail-closed: unknown usage is treated as "at the limit" by returning a
      // value that trips the ceiling check rather than under-reporting.
      return Number.MAX_SAFE_INTEGER
    }
    return count ?? 0
  }

  private async sumRunCost(organizationId: string, since: Date): Promise<number> {
    const { data, error } = await this.supabase
      .from('authority_query_runs')
      .select('actual_cost')
      .eq('organization_id', organizationId)
      .gte('created_at', since.toISOString())
      .limit(5000)

    if (error) {
      console.error(`[authority] sumRunCost failed: ${error.message}`)
      return Number.MAX_SAFE_INTEGER
    }

    return round6(
      (data ?? []).reduce((sum, row) => sum + Number((row as { actual_cost: number }).actual_cost ?? 0), 0)
    )
  }

  /** Whether the org-level AI kill switch (reused) is currently active. */
  async isOrganizationPaused(organizationId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('ai_usage_limits')
      .select('paused')
      .eq('organization_id', organizationId)
      .maybeSingle()
    return Boolean(data?.paused)
  }

  /**
   * Whether the platform-wide kill switch is active.
   *
   * Returns null when it cannot be determined. `system_flags` has no
   * client-facing RLS policy (migration 012), so a user- or anon-scoped client
   * will legitimately read nothing. We report null rather than false, because
   * conflating "cannot read" with "not enabled" would be a lie that hides a
   * real safety state.
   *
   * The authoritative enforcement is in SQL: `claim_background_jobs()` refuses
   * to hand out jobs while the switch is on, and every external call in this
   * subsystem runs as a claimed job.
   */
  async getGlobalPausedState(): Promise<boolean | null> {
    const { data, error } = await this.supabase
      .from('system_flags')
      .select('value')
      .eq('key', 'global_kill_switch')
      .maybeSingle()

    if (error) {
      if (/permission|policy|denied|row-level/i.test(error.message)) return null
      console.error(`[authority] global kill switch read failed: ${error.message}`)
      return null
    }
    if (!data) return null

    const value = (data as { value: unknown }).value
    if (value && typeof value === 'object' && 'enabled' in (value as Record<string, unknown>)) {
      return Boolean((value as Record<string, unknown>).enabled)
    }
    return value === true || value === 'true'
  }

  /**
   * Full decision for one call, gathering every input server-side so a caller
   * cannot under-report usage.
   */
  async authorize(params: {
    organizationId: string
    estimatedQueryCost: number
    importance: number
  }): Promise<BudgetDecision> {
    const [budget, usage, orgPaused, globalPaused] = await Promise.all([
      this.getBudget(params.organizationId),
      this.getUsage(params.organizationId),
      this.isOrganizationPaused(params.organizationId),
      this.getGlobalPausedState(),
    ])

    return evaluateBudget({
      organizationId: params.organizationId,
      budget,
      usage,
      estimatedQueryCost: params.estimatedQueryCost,
      importance: params.importance,
      organizationPaused: orgPaused,
      globalPaused,
    })
  }

  /** Operator/API action: pause or resume monitoring for an org. */
  async setPaused(organizationId: string, paused: boolean, reason: string | null): Promise<void> {
    const { error } = await this.supabase
      .from('authority_budgets')
      .upsert(
        { organization_id: organizationId, paused, pause_reason: paused ? reason : null },
        { onConflict: 'organization_id' }
      )
    if (error) throw new Error(`setPaused failed: ${error.message}`)
  }
}

function msUntilUtcMidnight(now = new Date()): number {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return tomorrow.getTime() - now.getTime()
}

function msUntilMonthStart(now = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return next.getTime() - now.getTime()
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}