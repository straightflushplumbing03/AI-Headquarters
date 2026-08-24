import { SupabaseClient } from '@supabase/supabase-js'
import type { ExecutiveDecision } from '@/types/phase4'

/**
 * Decision Log & Institutional Memory
 * Maintains searchable decision history with outcomes
 */
export class DecisionLogger {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Log an executive decision
   */
  async logDecision(
    organizationId: string,
    decision: Omit<ExecutiveDecision, 'id' | 'organization_id' | 'outcome_measured' | 'created_at'>
  ): Promise<ExecutiveDecision> {
    const { data, error } = await this.supabase
      .from('executive_decisions')
      .insert([
        {
          ...decision,
          organization_id: organizationId,
          outcome_measured: false,
          searchable_text: `${decision.decision_title} ${decision.decision_content} ${decision.reason || ''}`,
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Record outcome for a decision
   */
  async recordOutcome(
    decisionId: string,
    outcome: string,
    lesson: string
  ): Promise<ExecutiveDecision> {
    const { data, error } = await this.supabase
      .from('executive_decisions')
      .update({
        actual_outcome: outcome,
        outcome_measured: true,
        outcome_date: new Date().toISOString(),
        lesson_learned: lesson,
      })
      .eq('id', decisionId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Search decision history
   */
  async searchDecisions(
    organizationId: string,
    query: string,
    limit: number = 20
  ): Promise<ExecutiveDecision[]> {
    const { data } = await this.supabase
      .from('executive_decisions')
      .select('*')
      .eq('organization_id', organizationId)
      .or(`decision_title.ilike.%${query}%,decision_content.ilike.%${query}%,reason.ilike.%${query}%`)
      .order('decision_date', { ascending: false })
      .limit(limit)

    return data || []
  }

  /**
   * Get decisions by timeframe
   */
  async getDecisionsByTimeframe(
    organizationId: string,
    daysBack: number = 30
  ): Promise<ExecutiveDecision[]> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - daysBack)

    const { data } = await this.supabase
      .from('executive_decisions')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('decision_date', cutoff.toISOString())
      .order('decision_date', { ascending: false })

    return data || []
  }

  /**
   * Get decisions with measured outcomes
   */
  async getOutcomeMeasuredDecisions(organizationId: string): Promise<ExecutiveDecision[]> {
    const { data } = await this.supabase
      .from('executive_decisions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('outcome_measured', true)
      .order('outcome_date', { ascending: false })

    return data || []
  }

  /**
   * Extract lessons learned
   */
  async extractLessons(organizationId: string): Promise<string[]> {
    const decisions = await this.getOutcomeMeasuredDecisions(organizationId)

    return decisions
      .filter((d) => d.lesson_learned)
      .map((d) => d.lesson_learned)
      .filter((lesson): lesson is string => Boolean(lesson))
  }

  /**
   * Get decision success rate
   */
  async getDecisionSuccessRate(organizationId: string): Promise<{
    total: number
    measured: number
    successful: number
    failed: number
    success_rate: number
  }> {
    const decisions = await this.getOutcomeMeasuredDecisions(organizationId)

    const successful = decisions.filter(
      (d) => d.actual_outcome && d.actual_outcome.toLowerCase().includes('success')
    ).length
    const failed = decisions.length - successful

    return {
      total: decisions.length,
      measured: decisions.length,
      successful,
      failed,
      success_rate: decisions.length > 0 ? (successful / decisions.length) * 100 : 0,
    }
  }

  /**
   * Get decision explainability
   */
  async getDecisionExplainability(decisionId: string): Promise<any> {
    const { data } = await this.supabase
      .from('executive_decisions')
      .select('*')
      .eq('id', decisionId)
      .single()

    if (!data) return null

    return {
      decision: data.decision_title,
      date: data.decision_date,
      reason: data.reason,
      confidence: data.confidence,
      evidence: data.evidence,
      alternatives: data.alternatives_considered,
      expected_outcome: data.expected_outcome,
      actual_outcome: data.actual_outcome,
      lesson: data.lesson_learned,
      explainability: `This decision was made because: ${data.reason}. Evidence supporting the decision: ${JSON.stringify(data.evidence)}. Confidence level: ${(data.confidence * 100).toFixed(0)}%. Alternatives considered: ${data.alternatives_considered?.join(', ') || 'none specified'}.`,
    }
  }
}
