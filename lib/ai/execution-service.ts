/**
 * AI Execution Service
 * Orchestrates budget checks, provider calls, and cost tracking
 * CRITICAL: Budget check BEFORE provider execution
 */

import { SupabaseClient } from '@supabase/supabase-js'
import { getAIProvider } from './providers'
import { AICostController } from './cost-controller'
import type { AIExecutionRequest, AIExecutionResult } from '@/types/ai'

export class AIExecutionService {
  private costController: AICostController

  constructor(private supabase: SupabaseClient) {
    this.costController = new AICostController(supabase)
  }

  /**
   * Main execution method
   * FAIL-CLOSED: Checks budget BEFORE calling provider
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

    // 5. CHECK BUDGET BEFORE PROVIDER CALL (FAIL-CLOSED)
    const budgetCheck = await this.costController.checkBudget(
      request.organizationId,
      request.agentId,
      estimatedCost
    )

    if (!budgetCheck.allowed) {
      return {
        success: false,
        content: '',
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
        actualCost: 0,
        executionTimeMs: 0,
        error: budgetCheck.reason || 'Budget exceeded',
        errorType: 'budget_exceeded',
      }
    }

    // 6. NOW EXECUTE PROVIDER (Budget check passed)
    const result = await provider.execute(request)

    // 7. RECORD COST (regardless of success/failure)
    if (result.actualCost > 0) {
      await this.costController.recordCost(
        request.organizationId,
        request.agentId,
        request.taskId,
        result.actualCost,
        result.provider || 'unknown',
        result.model || 'unknown',
        result.inputTokens,
        result.outputTokens,
        result.executionTimeMs
      )
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
   * Kill switches
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
