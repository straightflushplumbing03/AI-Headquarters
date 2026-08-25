import { SupabaseClient } from '@supabase/supabase-js';

export class ExecutiveCommandCenter {
  constructor(private supabase: SupabaseClient) {}

  async generateExecutiveBriefing(organizationId: string) {
    const { data: decisions } = await this.supabase
      .from('autonomous_decisions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(10);

    const { data: healthSnapshot } = await this.supabase
      .from('business_health_snapshots')
      .select('*')
      .eq('organization_id', organizationId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .single();

    const { data: opportunities } = await this.supabase
      .from('opportunities')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'new')
      .order('opportunity_score', { ascending: false })
      .limit(3);

    return {
      generated_at: new Date().toISOString(),
      what_happened: `${decisions?.length || 0} autonomous decisions made`,
      business_health: healthSnapshot?.overall_health_score || 0,
      top_opportunity: opportunities?.[0]?.title || 'None',
      opportunity_score: opportunities?.[0]?.opportunity_score || 0,
    };
  }

  async getFiveMinuteBriefing(organizationId: string): Promise<string> {
    const briefing = await this.generateExecutiveBriefing(organizationId);

    return `
🤖 AI EXECUTIVE COMMAND CENTER - 5 MINUTE BRIEFING
====================================================

📊 WHAT HAPPENED:
${briefing.what_happened}
Business Health: ${briefing.business_health}/100

🎯 TOP OPPORTUNITY:
${briefing.top_opportunity}
Score: ${briefing.opportunity_score}/100

⏰ Generated: ${briefing.generated_at}
    `;
  }
}
