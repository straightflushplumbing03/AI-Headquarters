import { SupabaseClient } from '@supabase/supabase-js'
import type { TaskOutcome } from '@/types/ai'

/**
 * Task Outcome Tracking & Learning
 * Stores results and extracts learnings
 */
export class OutcomeTracker {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Record task outcome for learning
   */
  async recordOutcome(
    organizationId: string,
    taskId: string,
    agentId: string,
    objective: string,
    result: string,
    success: boolean,
    learnings: string[] = []
  ): Promise<TaskOutcome> {
    const { data, error } = await this.supabase
      .from('task_outcomes')
      .insert([
        {
          organization_id: organizationId,
          task_id: taskId,
          agent_id: agentId,
          objective,
          result,
          success,
          learnings,
          metrics: {
            timestamp: new Date().toISOString(),
          },
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get agent success rate
   */
  async getAgentSuccessRate(agentId: string): Promise<{
    total: number
    successful: number
    failed: number
    successRate: number
  }> {
    const { data } = await this.supabase
      .from('task_outcomes')
      .select('success')
      .eq('agent_id', agentId)

    if (!data || data.length === 0) {
      return { total: 0, successful: 0, failed: 0, successRate: 0 }
    }

    const successful = data.filter((d) => d.success).length
    const failed = data.length - successful

    return {
      total: data.length,
      successful,
      failed,
      successRate: (successful / data.length) * 100,
    }
  }

  /**
   * Extract and store learnings from outcomes
   */
  async extractLearnings(organizationId: string, limit: number = 20): Promise<string[]> {
    const { data: outcomes } = await this.supabase
      .from('task_outcomes')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('success', true)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (!outcomes || outcomes.length === 0) return []

    const allLearnings: string[] = []
    for (const outcome of outcomes) {
      if (outcome.learnings && Array.isArray(outcome.learnings)) {
        allLearnings.push(...outcome.learnings)
      }
    }

    // Store unique learnings in company memory
    const uniqueLearnings = Array.from(new Set(allLearnings))
    for (const learning of uniqueLearnings.slice(0, 10)) {
      await this.supabase.from('company_memory').insert([
        {
          organization_id: organizationId,
          category: 'learned',
          title: 'Extracted Learning',
          content: learning,
        },
      ])
    }

    return uniqueLearnings
  }

  /**
   * Get outcomes for time period
   */
  async getOutcomesForPeriod(
    organizationId: string,
    startDate: Date,
    endDate: Date
  ): Promise<TaskOutcome[]> {
    const { data } = await this.supabase
      .from('task_outcomes')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .order('created_at', { ascending: false })

    return data || []
  }

  /**
   * Get top learnings by frequency
   */
  async getTopLearnings(organizationId: string, limit: number = 10): Promise<string[]> {
    const { data: learnings } = await this.supabase
      .from('company_memory')
      .select('content')
      .eq('organization_id', organizationId)
      .eq('category', 'learned')
      .order('created_at', { ascending: false })
      .limit(limit)

    return (learnings || []).map((l) => l.content)
  }
}
