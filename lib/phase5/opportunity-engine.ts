import { SupabaseClient } from '@supabase/supabase-js';
import { Phase5 } from '../../types/phase5';

export class OpportunityEngine {
  constructor(private supabase: SupabaseClient) {}

  async getTopOpportunities(organizationId: string, limit: number = 10): Promise<Phase5.Opportunity[]> {
    const { data: opportunities } = await this.supabase
      .from('opportunities')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'new')
      .order('opportunity_score', { ascending: false })
      .limit(limit);

    return (opportunities || []) as Phase5.Opportunity[];
  }

  async createOpportunity(
    organizationId: string,
    data: Omit<Phase5.Opportunity, 'id' | 'organization_id' | 'created_at' | 'updated_at'>
  ): Promise<Phase5.Opportunity> {
    const { data: created, error } = await this.supabase
      .from('opportunities')
      .insert({
        organization_id: organizationId,
        ...data,
      })
      .select()
      .single();

    if (error) throw error;
    return created as Phase5.Opportunity;
  }

  async updateStatus(
    opportunityId: string,
    status: Phase5.OpportunityStatus
  ): Promise<void> {
    await this.supabase
      .from('opportunities')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', opportunityId);
  }
}
