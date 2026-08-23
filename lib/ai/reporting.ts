import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Daily Executive Report Generator
 * Produces morning briefing with actual data
 */
export class ExecutiveReportGenerator {
  constructor(private supabase: SupabaseClient) {}

  async generateDailyReport(organizationId: string, userId: string): Promise<{
    greeting: string
    summary: string
    metrics: {
      tasksCompleted: number
      tasksFailed: number
      opportunitiesDiscovered: number
      recommendationsWaiting: number
      competitorChanges: number
      aiCost: number
      aiExecutionTime: string
    }
    topOpportunity?: string
    recentCompletions: Array<{ title: string; status: string; result?: string }>
    failedTasks: Array<{ title: string; error?: string }>
    pendingApprovals: Array<{ title: string; type: string }>
    spending: {
      spent: number
      budget: number
      percentage: number
      remaining: number
    }
    executionSummary: string
  }> {
    // Get user name
    const { data: user } = await this.supabase.auth.getUser()
    const userName = user?.user?.user_metadata?.name || 'there'

    // Get yesterday's date
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]
    const todayStr = new Date().toISOString().split('T')[0]

    // Load metrics
    const completedTasks = await this.getCompletedTasks(organizationId, yesterdayStr, todayStr)
    const failedTasks = await this.getFailedTasks(organizationId, yesterdayStr, todayStr)
    const executionLogs = await this.getExecutionLogs(organizationId, yesterdayStr, todayStr)
    const pendingApprovals = await this.getPendingApprovals(organizationId)
    const spending = await this.getSpending(organizationId)
    const opportunities = await this.getOpportunities(organizationId, yesterdayStr, todayStr)
    const competitorChanges = await this.getCompetitorChanges(organizationId, yesterdayStr, todayStr)

    // Calculate totals
    const totalCost = executionLogs.reduce((sum, log) => sum + (log.estimated_cost || 0), 0)
    const totalExecutionTime = executionLogs.reduce((sum, log) => sum + (log.execution_time_ms || 0), 0)

    return {
      greeting: `Good morning, ${userName}.`,
      summary: `Your AI workforce worked for ${this.formatDuration(totalExecutionTime)} yesterday and completed ${completedTasks.length} tasks.`,
      metrics: {
        tasksCompleted: completedTasks.length,
        tasksFailed: failedTasks.length,
        opportunitiesDiscovered: opportunities.length,
        recommendationsWaiting: pendingApprovals.filter((a) => a.request_type === 'task_execution').length,
        competitorChanges: competitorChanges.length,
        aiCost: totalCost,
        aiExecutionTime: this.formatDuration(totalExecutionTime),
      },
      topOpportunity: opportunities[0]?.description,
      recentCompletions: completedTasks.slice(0, 5).map((t) => ({
        title: t.title,
        status: t.status,
        result: t.result,
      })),
      failedTasks: failedTasks.map((t) => ({
        title: t.title,
        error: t.error,
      })),
      pendingApprovals: pendingApprovals.slice(0, 5).map((a) => ({
        title: a.title,
        type: a.request_type,
      })),
      spending: {
        spent: spending.current_spend,
        budget: spending.monthly_budget,
        percentage: (spending.current_spend / spending.monthly_budget) * 100,
        remaining: spending.monthly_budget - spending.current_spend,
      },
      executionSummary: this.generateSummary(
        completedTasks.length,
        failedTasks.length,
        totalCost,
        opportunities.length,
        pendingApprovals.length
      ),
    }
  }

  private async getCompletedTasks(
    organizationId: string,
    startDate: string,
    endDate: string
  ): Promise<any[]> {
    const { data } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'completed')
      .gte('completed_at', `${startDate}T00:00:00`)
      .lte('completed_at', `${endDate}T23:59:59`)
      .order('completed_at', { ascending: false })

    return data || []
  }

  private async getFailedTasks(
    organizationId: string,
    startDate: string,
    endDate: string
  ): Promise<any[]> {
    const { data } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'failed')
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)
      .order('created_at', { ascending: false })

    return data || []
  }

  private async getExecutionLogs(
    organizationId: string,
    startDate: string,
    endDate: string
  ): Promise<any[]> {
    const { data } = await this.supabase
      .from('ai_execution_logs')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)

    return data || []
  }

  private async getPendingApprovals(organizationId: string): Promise<any[]> {
    const { data } = await this.supabase
      .from('approval_requests')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    return data || []
  }

  private async getSpending(organizationId: string): Promise<any> {
    const { data } = await this.supabase
      .from('ai_usage_limits')
      .select('*')
      .eq('organization_id', organizationId)
      .single()

    return data || { monthly_budget: 100, current_spend: 0 }
  }

  private async getOpportunities(
    organizationId: string,
    startDate: string,
    endDate: string
  ): Promise<any[]> {
    const { data } = await this.supabase
      .from('activity_events')
      .select('*')
      .eq('organization_id', organizationId)
      .ilike('event_type', '%opportunity%')
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)

    return data || []
  }

  private async getCompetitorChanges(
    organizationId: string,
    startDate: string,
    endDate: string
  ): Promise<any[]> {
    const { data } = await this.supabase
      .from('activity_events')
      .select('*')
      .eq('organization_id', organizationId)
      .ilike('event_type', '%competitor%')
      .gte('created_at', `${startDate}T00:00:00`)
      .lte('created_at', `${endDate}T23:59:59`)

    return data || []
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) return `${hours}h ${minutes}m`
    if (minutes > 0) return `${minutes}m ${seconds}s`
    return `${seconds}s`
  }

  private generateSummary(
    completed: number,
    failed: number,
    cost: number,
    opportunities: number,
    approvals: number
  ): string {
    let summary = ''

    if (completed > 0) {
      summary += `✓ ${completed} task${completed !== 1 ? 's' : ''} completed. `
    }

    if (failed > 0) {
      summary += `✗ ${failed} task${failed !== 1 ? 's' : ''} failed. `
    }

    if (cost > 0) {
      summary += `💰 AI cost: $${cost.toFixed(2)}. `
    }

    if (opportunities > 0) {
      summary += `🎯 ${opportunities} opportunit${opportunities !== 1 ? 'ies' : 'y'} discovered. `
    }

    if (approvals > 0) {
      summary += `⏳ ${approvals} decision${approvals !== 1 ? 's' : ''} awaiting approval. `
    }

    return summary.trim()
  }
}
