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
    // Note: searchable_text is a GENERATED column in the database — do not insert it manually
    const { data, error } = await this.supabase.from('strategic_learnings').insert([
      {
        organization_id: organizationId,
        topic,
        learning,
        context,
        evidence,
        discovered_at: new Date().toISOString(),
      },
    ])

    if (error) throw error
    return data
  }

  /**
   * Record a pattern
   * conditions is stored as JSONB in the database
   */
  async recordPattern(
    organizationId: string,
    pattern_name: string,
    description: string,
    conditions: string[] | Record<string, any>,
    expected_outcome: string,
    effectiveness: number,
    use_cases?: string[]
  ): Promise<any> {
    const { data, error } = await this.supabase.from('discovered_patterns').insert([
      {
        organization_id: organizationId,
        pattern_name,
        description,
        // conditions is JSONB — both string arrays and plain objects are valid
        conditions,
        expected_outcome,
        effectiveness, // 0-1 scale
        use_cases: use_cases || [],
        first_discovered_at: new Date().toISOString(),
      },
    ])

    if (error) throw error
    return data
  }

  /**
   * Search learnings using full-text search (GIN index on searchable_text)
   * Falls back to ILIKE if the FTS query is empty or invalid
   */
  async searchLearnings(organizationId: string, query: string, limit: number = 20): Promise<any[]> {
    if (!query.trim()) {
      const { data } = await this.supabase
        .from('strategic_learnings')
        .select('*')
        .eq('organization_id', organizationId)
        .order('discovered_at', { ascending: false })
        .limit(limit)
      return data || []
    }

    // Use PostgreSQL FTS via the GIN index on searchable_text
    const { data } = await this.supabase
      .from('strategic_learnings')
      .select('*')
      .eq('organization_id', organizationId)
      .textSearch('searchable_text', query, { type: 'websearch', config: 'english' })
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
    const learnings = await this.supabase
      .from('strategic_learnings')
      .select('count')
      .eq('organization_id', organizationId)

    const patterns = await this.supabase
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
