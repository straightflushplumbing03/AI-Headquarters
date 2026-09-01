import { SupabaseClient } from '@supabase/supabase-js';

export class WebsiteRevenueIntelligence {
  constructor(private supabase: SupabaseClient) {}

  async analyzePageRevenue(
    organizationId: string
  ): Promise<Array<{ page_url: string; revenue: number; leads: number; jobs: number }>> {
    const { data: events } = await this.supabase
      .from('attribution_events')
      .select('page_url, event_type, revenue_amount')
      .eq('organization_id', organizationId)
      .not('page_url', 'is', null);

    const pageMetrics: Record<string, { revenue: number; leads: number; jobs: number }> = {};

    (events || []).forEach((event) => {
      if (!pageMetrics[event.page_url]) {
        pageMetrics[event.page_url] = { revenue: 0, leads: 0, jobs: 0 };
      }

      if (event.event_type === 'revenue_recorded') {
        pageMetrics[event.page_url].revenue += event.revenue_amount || 0;
      } else if (event.event_type === 'lead_created') {
        pageMetrics[event.page_url].leads += 1;
      } else if (event.event_type === 'job_created') {
        pageMetrics[event.page_url].jobs += 1;
      }
    });

    return Object.entries(pageMetrics)
      .map(([page_url, metrics]) => ({
        page_url,
        ...metrics,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }
}
