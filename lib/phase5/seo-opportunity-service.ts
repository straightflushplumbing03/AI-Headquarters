import { SupabaseClient } from '@supabase/supabase-js';
import { Phase5 } from '../../types/phase5';

export class SEOOpportunityService {
  constructor(private supabase: SupabaseClient) {}

  async scoreOpportunities(organizationId: string): Promise<Phase5.OpportunityScoringBreakdown[]> {
    const { data: seoOppData } = await this.supabase
      .from('seo_opportunities')
      .select('*')
      .eq('organization_id', organizationId)
      .order('search_volume', { ascending: false })
      .limit(20);

    const scored: Phase5.OpportunityScoringBreakdown[] = (seoOppData || []).map((opp: any) => {
      const impact = Math.min(100, (opp.search_volume || 0) / 100);
      const effort = Math.max(1, opp.difficulty || 1);
      const urgency = opp.current_ranking && opp.current_ranking > 20 ? 80 : 50;
      const confidence = 75;
      const feasibility = Math.max(0, 100 - (opp.difficulty || 0));
      const roi = impact * (10 / effort);

      const score = impact * 0.4 + (100 - effort * 10) * 0.3 + urgency * 0.2 + feasibility * 0.1;

      return {
        title: opp.keyword,
        impact: Math.round(impact),
        effort: Math.round(effort * 10),
        urgency: Math.round(urgency),
        confidence,
        feasibility: Math.round(feasibility),
        roi: Math.round(roi),
        overall_score: Math.round(score),
        reasoning: `Keyword "${opp.keyword}" has ${opp.search_volume} monthly searches, currently ranked #${opp.current_ranking}. Difficulty: ${opp.difficulty}/100.`,
        priority_rank: 0,
      };
    });

    return scored.sort((a, b) => b.overall_score - a.overall_score);
  }
}
