import { SupabaseClient } from '@supabase/supabase-js';
import { Phase5 } from '../../types/phase5';

export class RecommendationEngine {
  constructor(private supabase: SupabaseClient) {}

  async getTopRecommendations(organizationId: string, limit: number = 5): Promise<Phase5.Recommendation[]> {
    const { data: recommendations } = await this.supabase
      .from('recommendations')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('execution_status', 'not_started')
      .order('priority')
      .order('opportunity_score', { ascending: false })
      .limit(limit);

    return recommendations || [];
  }

  async createRecommendation(
    organizationId: string,
    data: Omit<Phase5.Recommendation, 'id' | 'organization_id' | 'created_at' | 'updated_at'>
  ): Promise<Phase5.Recommendation> {
    const { data: created, error } = await this.supabase
      .from('recommendations')
      .insert({
        organization_id: organizationId,
        ...data,
      })
      .select()
      .single();

    if (error) throw error;
    return created as Phase5.Recommendation;
  }

  async approveRecommendation(
    recommendationId: string,
    approvedBy: string
  ): Promise<void> {
    await this.supabase
      .from('recommendations')
      .update({
        approval_status: 'approved',
        approved_by: approvedBy,
        approval_at: new Date().toISOString(),
      })
      .eq('id', recommendationId);
  }
}
