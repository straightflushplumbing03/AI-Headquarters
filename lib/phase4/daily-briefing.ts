import { SupabaseClient } from '@supabase/supabase-js'
import type { DailyBriefing } from '@/types/phase4'

/**
 * Daily Briefing System
 * Generates automated executive briefings
 */
export class DailyBriefingSystem {

  constructor(private supabase: SupabaseClient) {
  }

  /**
   * Generate daily briefing
   */
  async generateDailyBriefing(organizationId: string): Promise<DailyBriefing> {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const todayStr = today.toISOString().split('T')[0]
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    // Check if briefing already exists for today
    const { data: existing } = await this.supabase
      .from('daily_briefings')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('briefing_date', todayStr)
      .single()

    if (existing) {
      return existing
    }

    // Gather yesterday's data
    const yesterdayData = await this.gatherYesterdayData(organizationId, yesterdayStr)

    // Gather today's planned work
    const todayData = await this.gatherTodayData(organizationId)

    // Gather alerts
    const alerts = await this.gatherAlerts(organizationId)

    // Generate CEO recommendation
    const ceoRec = await this.generateCEORecommendation(
      organizationId,
      yesterdayData,
      todayData,
      alerts
    )

    // Create briefing
    const { data: briefing, error } = await this.supabase
      .from('daily_briefings')
      .insert([
        {
          organization_id: organizationId,
          briefing_date: todayStr,
          yesterday_summary: this.formatYesterdayText(yesterdayData),
          today_summary: this.formatTodayText(todayData),
          alerts_summary: this.formatAlertsText(alerts),
          ceo_recommendation: ceoRec,
          metrics: {
            yesterday: yesterdayData,
            today: todayData,
            alerts: alerts,
          },
          generated_at: new Date().toISOString(),
        },
      ])
      .select()
      .single()

    if (error) throw error
    return briefing
  }

  /**
   * Gather yesterday's work summary
   */
  private async gatherYesterdayData(organizationId: string, dateStr: string) {
    const startDate = new Date(`${dateStr}T00:00:00Z`)
    const endDate = new Date(`${dateStr}T23:59:59Z`)

    const [outcomes, competitive, seoOpps, taskResults] = await Promise.all([
      this.supabase
        .from('task_outcomes')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString()),
      this.supabase
        .from('competitive_intelligence')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString()),
      this.supabase
        .from('seo_opportunities')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString()),
      this.supabase
        .from('tasks')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'completed')
        .gte('completed_at', startDate.toISOString())
        .lte('completed_at', endDate.toISOString()),
    ])

    return {
      outcomes_count: outcomes.data?.length || 0,
      successful_outcomes: outcomes.data?.filter((o) => o.success).length || 0,
      competitive_findings: competitive.data?.length || 0,
      competitive_changes: competitive.data?.filter((c) => c.is_change).length || 0,
      seo_opportunities_found: seoOpps.data?.length || 0,
      tasks_completed: taskResults.data?.length || 0,
    }
  }

  /**
   * Gather today's planned work
   */
  private async gatherTodayData(organizationId: string) {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    const [scheduledJobs, opportunities, workflows] = await Promise.all([
      this.supabase
        .from('scheduled_jobs')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .gte('next_run_at', `${todayStr}T00:00:00Z`)
        .lte('next_run_at', `${tomorrowStr}T00:00:00Z`),
      this.supabase
        .from('opportunities')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'identified')
        .order('priority_score', { ascending: false })
        .limit(5),
      this.supabase
        .from('workflow_executions')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('status', 'running')
        .limit(10),
    ])

    return {
      scheduled_tasks: scheduledJobs.data?.length || 0,
      top_opportunities: opportunities.data?.length || 0,
      active_workflows: workflows.data?.length || 0,
    }
  }

  /**
   * Gather alerts
   */
  private async gatherAlerts(organizationId: string) {
    const { data } = await this.supabase
      .from('competitor_alerts')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'new')
      .in('severity', ['high', 'critical'])
      .limit(10)

    return data || []
  }

  /**
   * Format yesterday summary text
   */
  private formatYesterdayText(data: any): string {
    return `
YESTERDAY'S ACTIVITY

Tasks Completed: ${data.tasks_completed}
Outcomes Generated: ${data.outcomes_count} (${data.successful_outcomes} successful)

Competitive Intelligence: ${data.competitive_findings} findings (${data.competitive_changes} changes detected)

SEO Opportunities: ${data.seo_opportunities_found} new opportunities discovered

Status: ${data.successful_outcomes / (data.outcomes_count || 1) > 0.7 ? 'Strong execution day' : 'Requires attention'}
    `.trim()
  }

  /**
   * Format today summary text
   */
  private formatTodayText(data: any): string {
    return `
TODAY'S PLANNED WORK

Scheduled Tasks: ${data.scheduled_tasks}
Active Workflows: ${data.active_workflows}
Top Opportunities to Evaluate: ${data.top_opportunities}

Expected Focus Areas:
- Competitive intelligence gathering
- SEO opportunity discovery
- Website optimization analysis
- Local search opportunities
- Analytics review
    `.trim()
  }

  /**
   * Format alerts text
   */
  private formatAlertsText(alerts: any[]): string {
    if (alerts.length === 0) {
      return 'No critical alerts.'
    }

    const formatted = alerts
      .map(
        (alert) =>
          `\n[${alert.severity.toUpperCase()}] ${alert.competitor_name}: ${alert.finding}\nRecommended Action: ${alert.action_recommended}`
      )
      .join('\n')

    return `CRITICAL ALERTS\n${formatted}`
  }

  /**
   * Generate CEO recommendation
   */
  private async generateCEORecommendation(
    _organizationId: string,
    yesterday: any,
    today: any,
    alerts: any[]
  ): Promise<string> {
    const criticalAlerts = alerts.filter((a) => a.severity === 'critical').length

    let recommendation = 'CEO RECOMMENDATION:\n\n'

    if (criticalAlerts > 0) {
      recommendation += `⚠️ Address ${criticalAlerts} critical competitor movement(s) immediately.\n\n`
    }

    if (today.top_opportunities > 0) {
      recommendation += `📊 Prioritize evaluation of ${today.top_opportunities} high-value opportunities.\n\n`
    }

    if (yesterday.successful_outcomes / (yesterday.outcomes_count || 1) > 0.7) {
      recommendation += `✅ Continue current strategy - execution velocity is strong.\n\n`
    } else {
      recommendation += `🔍 Investigate execution issues - success rate below expectations.\n\n`
    }

    recommendation += `Estimated Daily Cost: Monitor AI spend through budget dashboard.\n`
    recommendation += `Next Review: Tomorrow morning briefing.`

    return recommendation
  }

  /**
   * Get latest briefing
   */
  async getLatestBriefing(organizationId: string): Promise<DailyBriefing | null> {
    const { data } = await this.supabase
      .from('daily_briefings')
      .select('*')
      .eq('organization_id', organizationId)
      .order('briefing_date', { ascending: false })
      .limit(1)
      .single()

    return data || null
  }

  /**
   * Get briefing history
   */
  async getBriefingHistory(organizationId: string, days: number = 7): Promise<DailyBriefing[]> {
    const { data } = await this.supabase
      .from('daily_briefings')
      .select('*')
      .eq('organization_id', organizationId)
      .order('briefing_date', { ascending: false })
      .limit(days)

    return data || []
  }
}
