import { SupabaseClient } from '@supabase/supabase-js'
import type { CompetitiveIntelligence } from '@/types/phase3'

/**
 * Competitive Intelligence Agent Manager
 * Tracks competitor changes and generates intelligence findings
 */
export class CompetitiveIntelligenceManager {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Record competitive finding
   */
  async recordFinding(
    organizationId: string,
    finding: Omit<CompetitiveIntelligence, 'id' | 'created_at' | 'updated_at'>
  ): Promise<CompetitiveIntelligence> {
    // Check if similar finding exists (for change detection)
    const { data: existing } = await this.supabase
      .from('competitive_intelligence')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('competitor_name', finding.competitor_name)
      .eq('finding_type', finding.finding_type)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Mark as change if different from previous
    const isChange = existing && existing.finding !== finding.finding

    const { data, error } = await this.supabase
      .from('competitive_intelligence')
      .insert([
        {
          ...finding,
          organization_id: organizationId,
          is_change: isChange,
          previous_value: existing?.finding,
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get recent findings for competitor
   */
  async getCompetitorFindings(
    organizationId: string,
    competitorName: string,
    limit: number = 20
  ): Promise<CompetitiveIntelligence[]> {
    const { data } = await this.supabase
      .from('competitive_intelligence')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('competitor_name', competitorName)
      .order('created_at', { ascending: false })
      .limit(limit)

    return data || []
  }

  /**
   * Get all competitors
   */
  async getCompetitors(organizationId: string): Promise<string[]> {
    const { data } = await this.supabase
      .from('competitive_intelligence')
      .select('competitor_name')
      .eq('organization_id', organizationId)

    const names = (data || []).map((d: { competitor_name: string }) => d.competitor_name).filter(Boolean)
    return [...new Set(names)]
  }

  /**
   * Get critical changes (is_change = true with high importance)
   */
  async getCriticalChanges(
    organizationId: string,
    daysBack: number = 7
  ): Promise<CompetitiveIntelligence[]> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysBack)

    const { data } = await this.supabase
      .from('competitive_intelligence')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_change', true)
      .in('importance', ['high', 'critical'])
      .gte('created_at', cutoffDate.toISOString())
      .order('created_at', { ascending: false })

    return data || []
  }

  /**
   * Get opportunities from competitive intelligence
   */
  async getOpportunitiesFromIntelligence(
    organizationId: string,
    limit: number = 10
  ): Promise<CompetitiveIntelligence[]> {
    const { data } = await this.supabase
      .from('competitive_intelligence')
      .select('*')
      .eq('organization_id', organizationId)
      .not('opportunity', 'is', null)
      .order('importance', { ascending: false })
      .limit(limit)

    return data || []
  }

  /**
   * Analysis of competitor trends
   */
  async getCompetitorTrends(
    organizationId: string,
    competitorName: string,
    category?: string
  ): Promise<{
    competitor: string
    total_findings: number
    recent_changes: number
    categories: Record<string, number>
    threat_level: 'low' | 'medium' | 'high' | 'critical'
  }> {
    let query = this.supabase
      .from('competitive_intelligence')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('competitor_name', competitorName)

    if (category) {
      query = query.eq('category', category)
    }

    const { data } = await query
    if (!data || data.length === 0) {
      return {
        competitor: competitorName,
        total_findings: 0,
        recent_changes: 0,
        categories: {},
        threat_level: 'low',
      }
    }

    const recentChanges = data.filter((d) => d.is_change).length
    const categories: Record<string, number> = {}
    let threatScore = 0

    for (const item of data) {
      if (item.category) {
        categories[item.category] = (categories[item.category] || 0) + 1
      }
      if (item.importance === 'critical') threatScore += 3
      if (item.importance === 'high') threatScore += 1
    }

    const threatLevel =
      threatScore > 10 ? 'critical' : threatScore > 5 ? 'high' : threatScore > 2 ? 'medium' : 'low'

    return {
      competitor: competitorName,
      total_findings: data.length,
      recent_changes: recentChanges,
      categories,
      threat_level: threatLevel as any,
    }
  }
}
