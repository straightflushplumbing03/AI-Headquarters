import { SupabaseClient } from '@supabase/supabase-js'
import type { CompetitorAlert } from '@/types/phase4'

/**
 * Competitor Watchtower
 * Persistent monitoring system for competitive threats and opportunities
 */
export class CompetitorWatchtower {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Record competitor alert
   */
  async recordAlert(
    organizationId: string,
    competitorName: string,
    finding: string,
    alertType: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    opportunity?: string,
    actionRecommended?: string
  ): Promise<CompetitorAlert> {
    const { data, error } = await this.supabase
      .from('competitor_alerts')
      .insert([
        {
          organization_id: organizationId,
          competitor_name: competitorName,
          alert_type: alertType,
          finding,
          opportunity,
          action_recommended: actionRecommended,
          severity,
          status: 'new',
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(organizationId: string): Promise<CompetitorAlert[]> {
    const { data } = await this.supabase
      .from('competitor_alerts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'new')
      .order('created_at', { ascending: false })

    return data || []
  }

  /**
   * Get critical alerts
   */
  async getCriticalAlerts(organizationId: string): Promise<CompetitorAlert[]> {
    const { data } = await this.supabase
      .from('competitor_alerts')
      .select('*')
      .eq('organization_id', organizationId)
      .in('severity', ['high', 'critical'])
      .eq('status', 'new')
      .order('created_at', { ascending: false })

    return data || []
  }

  /**
   * Mark alert as reviewed
   */
  async markAsReviewed(alertId: string): Promise<CompetitorAlert> {
    const { data, error } = await this.supabase
      .from('competitor_alerts')
      .update({ status: 'reviewed' })
      .eq('id', alertId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Mark alert as acted on (workflow created)
   */
  async markAsActedOn(alertId: string, workflowId: string): Promise<CompetitorAlert> {
    const { data, error } = await this.supabase
      .from('competitor_alerts')
      .update({
        status: 'acted_on',
        workflow_created_id: workflowId,
      })
      .eq('id', alertId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Dismiss alert
   */
  async dismissAlert(alertId: string): Promise<CompetitorAlert> {
    const { data, error } = await this.supabase
      .from('competitor_alerts')
      .update({ status: 'dismissed' })
      .eq('id', alertId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get alert summary by competitor
   */
  async getAlertSummaryByCompetitor(organizationId: string): Promise<Record<string, any>> {
    const { data: alerts } = await this.supabase
      .from('competitor_alerts')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })

    const summary: Record<string, any> = {}

    for (const alert of alerts || []) {
      if (!summary[alert.competitor_name]) {
        summary[alert.competitor_name] = {
          name: alert.competitor_name,
          total_alerts: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          new: 0,
          acted_on: 0,
          last_alert: alert.created_at,
          threat_level: 'low',
          opportunities: [],
        }
      }

      summary[alert.competitor_name].total_alerts++
      summary[alert.competitor_name][alert.severity]++
      if (alert.status === 'new') summary[alert.competitor_name].new++
      if (alert.status === 'acted_on') summary[alert.competitor_name].acted_on++
      if (alert.opportunity) summary[alert.competitor_name].opportunities.push(alert.opportunity)
    }

    // Calculate threat level
    for (const competitor in summary) {
      const data = summary[competitor]
      if (data.critical > 0 || data.high > 2) {
        data.threat_level = 'critical'
      } else if (data.high > 0) {
        data.threat_level = 'high'
      } else if (data.medium > 0) {
        data.threat_level = 'medium'
      }
    }

    return summary
  }

  /**
   * Get opportunity pipeline from alerts
   */
  async getOpportunitiesFromAlerts(organizationId: string): Promise<any[]> {
    const { data: alerts } = await this.supabase
      .from('competitor_alerts')
      .select('*')
      .eq('organization_id', organizationId)
      .not('opportunity', 'is', null)
      .order('severity', { ascending: false })
      .order('created_at', { ascending: false })

    return (
      alerts?.map((alert) => ({
        opportunity: alert.opportunity,
        source: `Competitive threat from ${alert.competitor_name}`,
        action: alert.action_recommended,
        urgency: alert.severity === 'critical' ? 'immediate' : alert.severity === 'high' ? 'urgent' : 'normal',
        discovered_at: alert.created_at,
      })) || []
    )
  }
}
