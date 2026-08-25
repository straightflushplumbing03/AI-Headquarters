import { SupabaseClient } from '@supabase/supabase-js';

export class CompetitiveIntelligenceEngine {
  constructor(private supabase: SupabaseClient) {}

  async recordCompetitiveObservation(
    organizationId: string,
    competitorName: string,
    observationType: string,
    observation: string,
    importance: 'low' | 'medium' | 'high' | 'critical'
  ) {
    const { data, error } = await this.supabase
      .from('competitive_intelligence')
      .insert({
        organization_id: organizationId,
        competitor_name: competitorName,
        finding_type: observationType,
        finding: observation,
        importance,
        discovered_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getCompetitiveThreats(organizationId: string) {
    const { data, error } = await this.supabase
      .from('competitive_intelligence')
      .select('*')
      .eq('organization_id', organizationId)
      .in('importance', ['high', 'critical'])
      .order('discovered_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    return data;
  }
}
