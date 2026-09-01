import { SupabaseClient } from '@supabase/supabase-js'
import type { AgentPerformance } from '@/types/phase4'

/**
 * Agent Performance Tracking System
 * Monitors and analyzes individual agent effectiveness
 */
export class AgentPerformanceTracker {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Record daily performance metrics
   */
  async recordPerformance(
    organizationId: string,
    agentId: string,
    metrics: Omit<AgentPerformance, 'id' | 'organization_id' | 'agent_id' | 'created_at'>
  ): Promise<AgentPerformance> {
    const { data, error } = await this.supabase
      .from('agent_performance')
      .insert([
        {
          ...metrics,
          organization_id: organizationId,
          agent_id: agentId,
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get agent performance over time
   */
  async getAgentPerformance(
    organizationId: string,
    agentId: string,
    daysBack: number = 30
  ): Promise<AgentPerformance[]> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - daysBack)

    const { data } = await this.supabase
      .from('agent_performance')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('agent_id', agentId)
      .gte('metric_date', cutoff.toISOString().split('T')[0])
      .order('metric_date', { ascending: true })

    return data || []
  }

  /**
   * Get performance summary for agent
   */
  async getAgentSummary(organizationId: string, agentId: string): Promise<any> {
    const performance = await this.getAgentPerformance(organizationId, agentId, 30)

    if (performance.length === 0) {
      return {
        agent_id: agentId,
        message: 'No performance data available',
      }
    }

    const totalTasksCompleted = performance.reduce((sum, p) => sum + p.tasks_completed, 0)
    const totalTasksFailed = performance.reduce((sum, p) => sum + p.tasks_failed, 0)
    const totalCost = performance.reduce((sum, p) => sum + p.total_cost, 0)
    const totalOpportunities = performance.reduce((sum, p) => sum + p.opportunities_discovered, 0)
    const totalOutcomes = performance.reduce((sum, p) => sum + p.outcomes_generated, 0)
    const avgExecutionTime =
      performance.filter((p) => p.average_execution_time_seconds).reduce((sum, p) => sum + (p.average_execution_time_seconds ?? 0), 0) /
      (performance.filter((p) => p.average_execution_time_seconds).length || 1)
    const avgAccuracy = performance
      .filter((p) => p.accuracy_score)
      .reduce((sum, p) => sum + (p.accuracy_score ?? 0), 0) / (performance.filter((p) => p.accuracy_score).length || 1)

    const successRate = totalTasksCompleted + totalTasksFailed > 0 ? (totalTasksCompleted / (totalTasksCompleted + totalTasksFailed)) * 100 : 0

    return {
      agent_id: agentId,
      period_days: 30,
      tasks_completed: totalTasksCompleted,
      tasks_failed: totalTasksFailed,
      success_rate: successRate,
      average_execution_time_seconds: avgExecutionTime,
      total_cost: totalCost,
      cost_per_task: totalTasksCompleted > 0 ? totalCost / totalTasksCompleted : 0,
      opportunities_discovered: totalOpportunities,
      outcomes_generated: totalOutcomes,
      accuracy_score: avgAccuracy,
      performance_trend: this.calculateTrend(performance),
    }
  }

  /**
   * Compare agent performance
   */
  async compareAgentPerformance(organizationId: string, _daysBack: number = 30): Promise<any[]> {
    const { data: agents } = await this.supabase
      .from('agent_registry')
      .select('id, name')
      .eq('organization_id', organizationId)
      .eq('status', 'active')

    const comparisons = []

    for (const agent of agents || []) {
      const summary = await this.getAgentSummary(organizationId, agent.id)
      comparisons.push({
        ...summary,
        agent_name: agent.name,
      })
    }

    return comparisons.sort((a, b) => b.success_rate - a.success_rate)
  }

  /**
   * Identify top-performing agents
   */
  async getTopPerformers(organizationId: string, limit: number = 5): Promise<any[]> {
    const comparison = await this.compareAgentPerformance(organizationId, 30)
    return comparison.slice(0, limit)
  }

  /**
   * Identify underperforming agents
   */
  async getUnderperformers(organizationId: string, limit: number = 5): Promise<any[]> {
    const comparison = await this.compareAgentPerformance(organizationId, 30)
    return comparison.slice(-limit).reverse()
  }

  /**
   * Get cost efficiency ranking
   */
  async getCostEfficiencyRanking(organizationId: string): Promise<any[]> {
    const comparison = await this.compareAgentPerformance(organizationId, 30)

    return comparison
      .filter((c) => c.tasks_completed > 0)
      .map((c) => ({
        ...c,
        cost_effectiveness: c.tasks_completed / c.total_cost, // tasks per dollar
      }))
      .sort((a, b) => b.cost_effectiveness - a.cost_effectiveness)
  }

  /**
   * Calculate performance trend
   */
  private calculateTrend(performance: AgentPerformance[]): 'improving' | 'declining' | 'stable' {
    if (performance.length < 2) return 'stable'

    const firstHalf = performance.slice(0, Math.floor(performance.length / 2))
    const secondHalf = performance.slice(Math.floor(performance.length / 2))

    const firstAvgSuccess =
      firstHalf.reduce((sum, p) => sum + p.tasks_completed / (p.tasks_completed + p.tasks_failed || 1), 0) / firstHalf.length
    const secondAvgSuccess =
      secondHalf.reduce((sum, p) => sum + p.tasks_completed / (p.tasks_completed + p.tasks_failed || 1), 0) / secondHalf.length

    if (secondAvgSuccess > firstAvgSuccess * 1.1) return 'improving'
    if (secondAvgSuccess < firstAvgSuccess * 0.9) return 'declining'
    return 'stable'
  }
}
