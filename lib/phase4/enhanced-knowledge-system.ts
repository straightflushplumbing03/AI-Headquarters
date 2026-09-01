import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Enhanced Knowledge System
 * Institutional memory for patterns, learnings, and strategic insights
 */
export class EnhancedKnowledgeSystem {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Record a strategic learning
   */
  async recordLearning(
    organizationId: string,
    topic: string,
    learning: string,
    context?: string,
    evidence?: Record<string, any>
  ): Promise<any> {
    const { data, error } = await this.supabase.from('strategic_learnings').insert([
      {
        organization_id: organizationId,
        topic,
        learning,
        context,
        evidence,
        discovered_at: new Date().toISOString(),
        searchable_text: `${topic} ${learning} ${context || ''}`,
      },
    ])

    if (error) throw error
    return data
  }

  /**
   * Record a pattern
   */
  async recordPattern(
    organizationId: string,
    pattern_name: string,
    description: string,
    conditions: string[],
    expected_outcome: string,
    effectiveness: number,
    use_cases?: string[]
  ): Promise<any> {
    const { data, error } = await this.supabase.from('discovered_patterns').insert([
      {
        organization_id: organizationId,
        pattern_name,
        description,
        conditions,
        expected_outcome,
        effectiveness, // 0-1 scale
        use_cases: use_cases || [],
        discovered_at: new Date().toISOString(),
      },
    ])

    if (error) throw error
    return data
  }

  /**
   * Search learnings
   */
  async searchLearnings(organizationId: string, query: string, limit: number = 20): Promise<any[]> {
    const { data } = await this.supabase
      .from('strategic_learnings')
      .select('*')
      .eq('organization_id', organizationId)
      .or(`topic.ilike.%${query}%,learning.ilike.%${query}%,context.ilike.%${query}%`)
      .order('discovered_at', { ascending: false })
      .limit(limit)

    return data || []
  }

  /**
   * Get patterns by effectiveness
   */
  async getEffectivePatterns(organizationId: string, minEffectiveness: number = 0.7): Promise<any[]> {
    const { data } = await this.supabase
      .from('discovered_patterns')
      .select('*')
      .eq('organization_id', organizationId)
      .gte('effectiveness', minEffectiveness)
      .order('effectiveness', { ascending: false })

    return data || []
  }

  /**
   * Get knowledge summary
   */
  async getKnowledgeSummary(organizationId: string): Promise<any> {
    const { data: learnings } = await this.supabase
      .from('strategic_learnings')
      .select('count')
      .eq('organization_id', organizationId)

    const { data: patterns } = await this.supabase
      .from('discovered_patterns')
      .select('count')
      .eq('organization_id', organizationId)

    return {
      total_learnings: learnings?.[0]?.count || 0,
      total_patterns: patterns?.[0]?.count || 0,
      knowledge_base_size: (learnings?.[0]?.count || 0) + (patterns?.[0]?.count || 0),
      status: 'operational',
    }
  }
}
