import { SupabaseClient } from '@supabase/supabase-js';
import { Phase5 } from '../../types/phase5';

export class BusinessHealthService {
  constructor(private supabase: SupabaseClient) {}

  async calculateHealthScore(organizationId: string): Promise<Phase5.BusinessHealthSnapshot> {
    const { data: kpis } = await this.supabase
      .from('business_kpis')
      .select('name, value, trend')
      .eq('organization_id', organizationId);

    const scores = {
      revenue: kpis?.some(k => k.trend === 'improving') ? 75 : 60,
      leads: kpis?.some(k => k.name?.includes('Lead')) ? 70 : 50,
      conversion: 65,
      seo: 70,
      website: 75,
      competitive: 70,
      workforce: 75,
    };

    const overall = Object.values(scores).reduce((a, b) => a + b) / Object.keys(scores).length;

    const snapshot: Omit<Phase5.BusinessHealthSnapshot, 'id' | 'created_at'> = {
      organization_id: organizationId,
      overall_health_score: Math.round(overall),
      revenue_health: scores.revenue,
      lead_health: scores.leads,
      conversion_health: scores.conversion,
      seo_health: scores.seo,
      website_health: scores.website,
      competitive_health: scores.competitive,
      workforce_health: scores.workforce,
      snapshot_date: new Date().toISOString().split('T')[0],
      snapshot_period: 'daily',
      trend_summary: overall > 70 ? 'improving' : 'stable',
      top_strengths: ['Website performance', 'Lead volume'],
      top_concerns: overall < 60 ? ['Revenue declining'] : [],
      generated_by_system: 'business-health-service',
    };

    const { data: stored } = await this.supabase
      .from('business_health_snapshots')
      .insert(snapshot)
      .select()
      .single();

    return stored as Phase5.BusinessHealthSnapshot;
  }
}
