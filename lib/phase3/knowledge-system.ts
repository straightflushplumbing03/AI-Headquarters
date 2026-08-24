import { SupabaseClient } from '@supabase/supabase-js'
import type { OrganizationalKnowledge } from '@/types/phase3'

/**
 * Knowledge System
 * Manages organizational learning and knowledge extraction from outcomes
 */
export class KnowledgeSystem {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Store knowledge from task outcome
   */
  async storeKnowledge(
    organizationId: string,
    knowledge: Omit<OrganizationalKnowledge, 'id' | 'created_at' | 'updated_at'>
  ): Promise<OrganizationalKnowledge> {
    const { data, error } = await this.supabase
      .from('organizational_knowledge')
      .insert([{ ...knowledge, organization_id: organizationId }])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Query knowledge by category and tags
   */
  async queryKnowledge(
    organizationId: string,
    filters?: {
      category?: string
      knowledge_type?: string
      tags?: string[]
      minConfidence?: number
    }
  ): Promise<OrganizationalKnowledge[]> {
    let query = this.supabase
      .from('organizational_knowledge')
      .select('*')
      .eq('organization_id', organizationId)

    if (filters?.category) {
      query = query.eq('category', filters.category)
    }

    if (filters?.knowledge_type) {
      query = query.eq('knowledge_type', filters.knowledge_type)
    }

    if (filters?.tags && filters.tags.length > 0) {
      // Use overlap operator for array matching
      query = query.overlaps('tags', filters.tags)
    }

    if (filters?.minConfidence) {
      query = query.gte('confidence', filters.minConfidence)
    }

    const { data } = await query.order('created_at', { ascending: false })

    return data || []
  }

  /**
   * Extract learnings from task outcome
   */
  async extractLearningsFromOutcome(
    organizationId: string,
    taskId: string,
    outcome: {
      objective: string
      result: string
      success: boolean
      learnings?: string[]
      confidence?: number
    }
  ): Promise<OrganizationalKnowledge[]> {
    const knowledge: Omit<OrganizationalKnowledge, 'id' | 'created_at' | 'updated_at'>[] = []

    // Store main outcome
    if (outcome.success) {
      knowledge.push({
        organization_id: organizationId,
        knowledge_type: 'outcome',
        category: 'task_results',
        title: `Successful task: ${outcome.objective}`,
        content: outcome.result,
        source_task_id: taskId,
        confidence: outcome.confidence || 0.8,
        embeddings_pending: true,
      })
    }

    // Store learnings
    if (outcome.learnings && outcome.learnings.length > 0) {
      for (const learning of outcome.learnings) {
        knowledge.push({
          organization_id: organizationId,
          knowledge_type: 'learning',
          category: 'extracted_learning',
          title: 'Extracted learning',
          content: learning,
          source_task_id: taskId,
          confidence: 0.7,
          embeddings_pending: true,
        })
      }
    }

    // Insert all knowledge
    const { data, error } = await this.supabase
      .from('organizational_knowledge')
      .insert(knowledge.map((k) => ({ ...k, organization_id: organizationId })))
      .select()

    if (error) throw error
    return data || []
  }

  /**
   * Get knowledge statistics
   */
  async getKnowledgeStats(
    organizationId: string
  ): Promise<{
    total_items: number
    by_type: Record<string, number>
    by_category: Record<string, number>
    average_confidence: number
  }> {
    const { data } = await this.supabase
      .from('organizational_knowledge')
      .select('knowledge_type,category,confidence')
      .eq('organization_id', organizationId)

    if (!data || data.length === 0) {
      return {
        total_items: 0,
        by_type: {},
        by_category: {},
        average_confidence: 0,
      }
    }

    const byType: Record<string, number> = {}
    const byCategory: Record<string, number> = {}
    let totalConfidence = 0

    for (const item of data) {
      byType[item.knowledge_type] = (byType[item.knowledge_type] || 0) + 1
      byCategory[item.category] = (byCategory[item.category] || 0) + 1
      totalConfidence += item.confidence || 0
    }

    return {
      total_items: data.length,
      by_type: byType,
      by_category: byCategory,
      average_confidence: totalConfidence / data.length,
    }
  }

  /**
   * Find similar knowledge (simple text search)
   */
  async findSimilarKnowledge(
    organizationId: string,
    query: string,
    limit: number = 5
  ): Promise<OrganizationalKnowledge[]> {
    // Simple text search using ilike
    const { data } = await this.supabase
      .from('organizational_knowledge')
      .select('*')
      .eq('organization_id', organizationId)
      .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
      .limit(limit)

    return data || []
  }
}
