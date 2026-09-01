import { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessKPI, ExecutiveDecision } from '@/types/phase4'

/**
 * Executive Dashboard Service
 * Provides real-time intelligence for the command center
 */
export class ExecutiveDashboard {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get complete executive state
   */
  async getExecutiveState(organizationId: string) {
    const [kpis, decisions, workflows, alerts, agents] = await Promise.all([
      this.getBusinessKPIs(organizationId),
      this.getRecentDecisions(organizationId, 5),
      this.getActiveWorkflows(organizationId),
      this.getCompetitorAlerts(organizationId),
      this.getAgentStatus(organizationId),
    ])

    return {
      kpis,
      recent_decisions: decisions,
      active_workflows: workflows.length,
      pending_approvals: workflows.filter((w) => w.status === 'waiting_approval').length,
      competitive_threats: alerts.filter((a) => a.severity === 'critical' || a.severity === 'high').length,
      agent_activity: agents,
      last_updated: new Date().toISOString(),
    }
  }

  /**
   * Get business KPIs
   */
  async getBusinessKPIs(organizationId: string): Promise<BusinessKPI[]> {
    const { data } = await this.supabase
      .from('business_kpis')
      .select('*')
      .eq('organization_id', organizationId)
      .order('last_updated', { ascending: false })
      .limit(20)

    return data || []
  }

  /**
   * Record KPI value
   */
  async recordKPI(
    organizationId: string,
    kpiType: string,
    name: string,
    value: number,
    unit?: string,
    dataSource?: string
  ): Promise<BusinessKPI> {
    // Get previous value for trend
    const { data: existing } = await this.supabase
      .from('business_kpis')
      .select('value')
      .eq('organization_id', organizationId)
      .eq('name', name)
      .order('last_updated', { ascending: false })
      .limit(1)
      .single()

    let trend: 'improving' | 'declining' | 'stable' = 'stable'
    if (existing?.value !== undefined && existing.value !== null) {
      trend = value > existing.value ? 'improving' : value < existing.value ? 'declining' : 'stable'
    }

    const { data, error } = await this.supabase
      .from('business_kpis')
      .insert([
        {
          organization_id: organizationId,
          kpi_type: kpiType,
          name,
          value,
          previous_value: existing?.value,
          trend,
          unit,
          data_source: dataSource,
          last_updated: new Date().toISOString(),
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get recent decisions
   */
  async getRecentDecisions(organizationId: string, limit: number = 10): Promise<ExecutiveDecision[]> {
    const { data } = await this.supabase
      .from('executive_decisions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('decision_date', { ascending: false })
      .limit(limit)

    return data || []
  }

  /**
   * Record executive decision
   */
  async recordDecision(
    organizationId: string,
    decision: Omit<ExecutiveDecision, 'id' | 'organization_id' | 'created_at'>
  ): Promise<ExecutiveDecision> {
    const { data, error } = await this.supabase
      .from('executive_decisions')
      .insert([
        {
          ...decision,
          organization_id: organizationId,
          searchable_text: `${decision.decision_title} ${decision.decision_content} ${decision.reason || ''}`,
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get active workflows
   */
  private async getActiveWorkflows(organizationId: string) {
    const { data } = await this.supabase
      .from('workflow_executions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'running')

    return data || []
  }

  /**
   * Get competitor alerts
   */
  private async getCompetitorAlerts(organizationId: string) {
    const { data } = await this.supabase
      .from('competitor_alerts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(10)

    return data || []
  }

  /**
   * Get agent status
   */
  private async getAgentStatus(organizationId: string) {
    const { data } = await this.supabase
      .from('agent_registry')
      .select('id, name, title, status, performance_metrics')
      .eq('organization_id', organizationId)
      .eq('status', 'active')

    return data || []
  }
}
