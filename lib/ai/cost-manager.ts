import { SupabaseClient } from '@supabase/supabase-js'

/**
 * AI Cost Tracking & Budget Management
 */
export class AICostManager {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Initialize budget for organization
   */
  async initializeBudget(organizationId: string, monthlyBudget: number = 100): Promise<void> {
    const resetDate = new Date()
    resetDate.setMonth(resetDate.getMonth() + 1)
    resetDate.setDate(1)

    await this.supabase.from('ai_usage_limits').upsert([
      {
        organization_id: organizationId,
        monthly_budget: monthlyBudget,
        current_spend: 0,
        reset_date: resetDate.toISOString().split('T')[0],
        paused: false,
      },
    ])
  }

  /**
   * Record AI execution cost
   */
  async recordCost(
    organizationId: string,
    cost: number,
    agentId?: string,
    taskId?: string
  ): Promise<void> {
    const { data: limits } = await this.supabase
      .from('ai_usage_limits')
      .select('current_spend')
      .eq('organization_id', organizationId)
      .single()

    const currentSpend = (limits?.current_spend || 0) + cost

    await this.supabase
      .from('ai_usage_limits')
      .update({ current_spend: currentSpend })
      .eq('organization_id', organizationId)
  }

  /**
   * Get current spending
   */
  async getSpending(organizationId: string): Promise<{
    monthly_budget: number
    current_spend: number
    remaining: number
    percentage_used: number
  }> {
    const { data } = await this.supabase
      .from('ai_usage_limits')
      .select('*')
      .eq('organization_id', organizationId)
      .single()

    if (!data) {
      return {
        monthly_budget: 100,
        current_spend: 0,
        remaining: 100,
        percentage_used: 0,
      }
    }

    return {
      monthly_budget: data.monthly_budget,
      current_spend: data.current_spend,
      remaining: data.monthly_budget - data.current_spend,
      percentage_used: (data.current_spend / data.monthly_budget) * 100,
    }
  }

  /**
   * Pause all AI execution for organization
   */
  async pauseAllAI(organizationId: string, reason: string): Promise<void> {
    await this.supabase
      .from('ai_usage_limits')
      .update({
        paused: true,
        pause_reason: reason,
      })
      .eq('organization_id', organizationId)
  }

  /**
   * Resume AI execution
   */
  async resumeAI(organizationId: string): Promise<void> {
    await this.supabase
      .from('ai_usage_limits')
      .update({
        paused: false,
        pause_reason: null,
      })
      .eq('organization_id', organizationId)
  }

  /**
   * Check if organization is paused
   */
  async isPaused(organizationId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('ai_usage_limits')
      .select('paused')
      .eq('organization_id', organizationId)
      .single()

    return data?.paused || false
  }

  /**
   * Get execution history with costs
   */
  async getExecutionHistory(
    organizationId: string,
    limit: number = 50
  ): Promise<any[]> {
    const { data } = await this.supabase
      .from('ai_execution_logs')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(limit)

    return data || []
  }

  /**
   * Calculate total cost for date range
   */
  async calculateCostRange(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    const { data } = await this.supabase
      .from('ai_execution_logs')
      .select('estimated_cost')
      .eq('organization_id', organizationId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())

    return (data || []).reduce((sum, log) => sum + (log.estimated_cost || 0), 0)
  }
}
