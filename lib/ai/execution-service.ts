/**
 * AI Execution Service
 * Orchestrates budget checks, provider calls, and cost tracking
 * CRITICAL: Budget check BEFORE provider execution
 *
 * Sprint 5.3 P2: budget authorization no longer uses read-modify-write on
 * ai_usage_limits.current_spend. The estimated cost is ATOMICALLY RESERVED in
 * the database (reserve_budget_idempotent: FOR UPDATE, kill-switch/pause
 * checks, remaining = budget - spend - open holds) BEFORE the provider is
 * called, and the actual cost is settled (clamped, idempotent) or the hold is
 * released afterwards. A caller can never spend more than the org's budget,
 * even under concurrent executions.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { getAIProvider } from './providers'
import { AICostController } from './cost-controller'
import { BudgetReservationService, PermanentBudgetError } from '@/lib/sprint3/budget-reservation'
import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'

export class AIExecutionService {
  private costController: AICostController
  private budget: BudgetReservationService

  constructor(private supabase: SupabaseClient) {
    this.costController = new AICostController(supabase)
    this.budget = new BudgetReservationService(supabase)
  }

  /**
   * Main execution method
   * FAIL-CLOSED: Atomically reserves budget BEFORE calling provider; settles
   * with the actual cost (clamped by the DB) or releases the hold on failure.
   */
  async execute(request: AIExecutionRequest): Promise<AIExecutionResult> {
    // 1. VERIFY ORGANIZATION EXISTS
    const { data: org } = await this.supabase
      .from('organizations')
      .select('id')
      .eq('id', request.organizationId)
      .single()

    if (!org) {
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: 0,
        error: 'Organization not found',
        errorType: 'invalid_organization',
      }
    }

    // 2. VERIFY AGENT EXISTS AND IS ACTIVE
    const { data: agent } = await this.supabase
      .from('agents')
      .select('id, active')
      .eq('id', request.agentId)
      .eq('organization_id', request.organizationId)
      .single()

    if (!agent) {
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: 0,
        error: 'Agent not found',
        errorType: 'invalid_agent',
      }
    }

    // 3. GET PROVIDER
    const provider = getAIProvider()
    if (!provider.isConfigured) {
      return {
        success: false,
        content: provider.errorMessage || 'No AI provider configured',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: 0,
        error: 'Provider not configured',
        errorType: 'provider_not_configured',
      }
    }

    // 4. ESTIMATE COST UPFRONT
    const inputEstimate = Math.ceil((request.systemPrompt.length + request.userMessage.length) / 4)
    const outputEstimate = request.maxTokens || 2000
    const estimatedCost = provider.estimateCost(inputEstimate, outputEstimate)

    // 5. ATOMIC BUDGET RESERVATION (replaces the racy read-modify-write check)
    //    The RPC re-checks fail-closed: global kill switch, org pause, and
    //    remaining budget under a row lock. Idempotent per task so retries and
    //    duplicate requests reuse the same hold instead of double-reserving.
    let reservationId: string | null = null
    try {
      const reservation = await this.budget.reserve({
        organizationId: request.organizationId,
        agentId: request.agentId,
        taskId: request.taskId,
        amount: estimatedCost,
        actionIdempotencyKey: `exec:${request.taskId}`,
        reference: 'ai-execution-service',
      })
      reservationId = reservation.reservationId
    } catch (error: any) {
      const message = error?.message || 'Budget authorization failed'
      console.error(
        `[AI Execute] budget authorization failed for org ${request.organizationId}: ${message}`
      )
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: 0,
        error: message,
        // Permanent = configuration problem (no budget row, invalid args);
        // transient = BUDGET_EXCEEDED / KILL_SWITCH_ACTIVE.
        errorType: error instanceof PermanentBudgetError ? 'budget_unavailable' : 'budget_exceeded',
      }
    }

    // 6. NOW EXECUTE PROVIDER (a valid atomic hold is in place)
    let result: AIExecutionResult
    try {
      result = await provider.execute(request)
    } catch (error: any) {
      // Provider threw — no spend recorded; free the hold.
      await this.budget.release(reservationId, request.organizationId)
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost,
        actualCost: 0,
        executionTimeMs: 0,
        error: `Provider execution failed: ${error?.message || 'unknown error'}`,
        errorType: 'provider_error',
      }
    }

    // 7. SETTLE OR RELEASE (settle failures are logged, never swallowed; the
    //    stale-hold reaper is the safety net for a failed settle).
    if (result.actualCost > 0) {
      try {
        await this.budget.settle(reservationId, request.organizationId, result.actualCost)
      } catch (error: any) {
        console.error(
          `[AI Execute] budget settle failed for reservation ${reservationId} in org ${request.organizationId}: ${error?.message}`
        )
      }

      try {
        await this.supabase.from('ai_execution_logs').insert([
          {
            organization_id: request.organizationId,
            agent_id: request.agentId,
            task_id: request.taskId,
            provider: result.provider || 'unknown',
            model: result.model || 'unknown',
            input_tokens: result.inputTokens,
            output_tokens: result.outputTokens,
            estimated_cost: result.actualCost,
            actual_cost: result.actualCost,
            execution_time_ms: result.executionTimeMs,
            status: result.success ? 'success' : 'failed',
          },
        ])
      } catch (error: any) {
        console.error(
          `[AI Execute] execution-log insert failed for org ${request.organizationId}: ${error?.message}`
        )
      }
    } else {
      // Nothing was spent (zero-cost run or provider-reported failure with no
      // tokens used) — free the hold so the budget is available again.
      await this.budget.release(reservationId, request.organizationId)
    }

    return result
  }

  /**
   * Get organization spending status
   */
  async getOrganizationSpending(organizationId: string): Promise<{
    monthlyBudget: number
    currentSpend: number
    remaining: number
    percentUsed: number
  }> {
    const { data } = await this.supabase
      .from('ai_usage_limits')
      .select('monthly_budget, current_spend')
      .eq('organization_id', organizationId)
      .single()

    if (!data) {
      return { monthlyBudget: 0, currentSpend: 0, remaining: 0, percentUsed: 0 }
    }

    const remaining = data.monthly_budget - (data.current_spend || 0)
    const percentUsed = (data.current_spend / data.monthly_budget) * 100

    return {
      monthlyBudget: data.monthly_budget,
      currentSpend: data.current_spend || 0,
      remaining: Math.max(0, remaining),
      percentUsed: Math.min(100, percentUsed),
    }
  }

  /**
   * Kill switches (durable state lives in ai_usage_limits.paused, which the
   * reservation RPC re-checks fail-closed; these passthroughs are kept for
   * the emergency-stop endpoint).
   */
  async enableGlobalKillSwitch(): Promise<void> {
    await this.costController.enableGlobalKillSwitch()
  }

  async disableGlobalKillSwitch(): Promise<void> {
    await this.costController.disableGlobalKillSwitch()
  }

  async enableOrganizationKillSwitch(organizationId: string): Promise<void> {
    await this.costController.enableOrganizationKillSwitch(organizationId)
  }

  async disableOrganizationKillSwitch(organizationId: string): Promise<void> {
    await this.costController.disableOrganizationKillSwitch(organizationId)
  }
}