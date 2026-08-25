import { SupabaseClient } from '@supabase/supabase-js'

export class AICostController {
  private globalKillSwitch: boolean = false
  private organizationKillSwitches: Set<string> = new Set()
  private agentKillSwitches: Set<string> = new Set()

  constructor(private supabase: SupabaseClient) {}

  async enableGlobalKillSwitch(): Promise<void> {
    this.globalKillSwitch = true
    await this.supabase
      .from('ai_usage_limits')
      .update({ paused: true, pause_reason: 'Global kill switch' })
      .neq('organization_id', '')
  }

  async disableGlobalKillSwitch(): Promise<void> {
    this.globalKillSwitch = false
    await this.supabase
      .from('ai_usage_limits')
      .update({ paused: false, pause_reason: null })
      .neq('organization_id', '')
  }

  async enableOrganizationKillSwitch(organizationId: string): Promise<void> {
    this.organizationKillSwitches.add(organizationId)
    await this.supabase
      .from('ai_usage_limits')
      .update({ paused: true, pause_reason: 'Org kill switch' })
      .eq('organization_id', organizationId)
  }

  async disableOrganizationKillSwitch(organizationId: string): Promise<void> {
    this.organizationKillSwitches.delete(organizationId)
    await this.supabase
      .from('ai_usage_limits')
      .update({ paused: false, pause_reason: null })
      .eq('organization_id', organizationId)
  }

  async enableAgentKillSwitch(agentId: string): Promise<void> {
    this.agentKillSwitches.add(agentId)
    await this.supabase.from('agents').update({ active: false }).eq('id', agentId)
  }

  async disableAgentKillSwitch(agentId: string): Promise<void> {
    this.agentKillSwitches.delete(agentId)
    await this.supabase.from('agents').update({ active: true }).eq('id', agentId)
  }

  async checkBudget(
    organizationId: string,
    agentId: string,
    estimatedCost: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (this.globalKillSwitch) return { allowed: false, reason: 'Global kill switch enabled' }
    if (this.organizationKillSwitches.has(organizationId)) return { allowed: false, reason: 'Org kill switch enabled' }
    if (this.agentKillSwitches.has(agentId)) return { allowed: false, reason: 'Agent disabled' }

    const { data: orgLimits } = await this.supabase
      .from('ai_usage_limits')
      .select('*')
      .eq('organization_id', organizationId)
      .single()

    if (orgLimits?.paused) return { allowed: false, reason: orgLimits.pause_reason }

    const { data: agent } = await this.supabase
      .from('agents')
      .select('active')
      .eq('id', agentId)
      .single()

    if (!agent?.active) return { allowed: false, reason: 'Agent not active' }

    if (orgLimits) {
      const remaining = orgLimits.monthly_budget - (orgLimits.current_spend || 0)
      if (estimatedCost > remaining) {
        return { allowed: false, reason: `Budget exceeded: $${remaining.toFixed(2)} remaining` }
      }
    }

    return { allowed: true }
  }

  async recordCost(
    organizationId: string,
    agentId: string,
    taskId: string,
    actualCost: number,
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    executionTimeMs: number
  ): Promise<void> {
    await this.supabase.from('ai_execution_logs').insert([
      {
        organization_id: organizationId,
        agent_id: agentId,
        task_id: taskId,
        provider,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost: actualCost,
        actual_cost: actualCost,
        execution_time_ms: executionTimeMs,
        status: 'success',
      },
    ])

    const { data: currentLimits } = await this.supabase
      .from('ai_usage_limits')
      .select('current_spend')
      .eq('organization_id', organizationId)
      .single()

    const newSpend = (currentLimits?.current_spend || 0) + actualCost
    await this.supabase
      .from('ai_usage_limits')
      .update({ current_spend: newSpend })
      .eq('organization_id', organizationId)
  }

  async getOrganizationMonthlySpend(organizationId: string): Promise<number> {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const { data } = await this.supabase
      .from('ai_execution_logs')
      .select('actual_cost')
      .eq('organization_id', organizationId)
      .gte('created_at', monthStart.toISOString())
    return data?.reduce((sum, log) => sum + (log.actual_cost || 0), 0) || 0
  }
}
