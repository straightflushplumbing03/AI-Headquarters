import { SupabaseClient } from '@supabase/supabase-js';
import { Phase5 } from '../../types/phase5';

export class AttributionService {
  constructor(private supabase: SupabaseClient) {}

  async recordEvent(
    organizationId: string,
    event: Omit<Phase5.AttributionEvent, 'id' | 'organization_id' | 'created_at'>
  ): Promise<Phase5.AttributionEvent> {
    const { data, error } = await this.supabase
      .from('attribution_events')
      .insert({
        organization_id: organizationId,
        ...event,
        event_timestamp: event.event_timestamp || new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data as Phase5.AttributionEvent;
  }

  async getRevenueByChannel(organizationId: string): Promise<Record<Phase5.Channel, number>> {
    const { data: events } = await this.supabase
      .from('attribution_events')
      .select('channel, revenue_amount')
      .eq('organization_id', organizationId)
      .eq('event_type', 'revenue_recorded')
      .not('revenue_amount', 'is', null);

    const revenue: Record<Phase5.Channel, number> = {} as any;
    (events || []).forEach((event) => {
      if (!revenue[event.channel as Phase5.Channel]) {
        revenue[event.channel as Phase5.Channel] = 0;
      }
      revenue[event.channel as Phase5.Channel] += event.revenue_amount || 0;
    });

    return revenue;
  }

  async getConversionFunnel(organizationId: string): Promise<{
    visits: number;
    leads: number;
    jobs: number;
    revenue: number;
    visit_to_lead: number;
    lead_to_job: number;
    job_to_revenue: number;
  }> {
    const { data: events } = await this.supabase
      .from('attribution_events')
      .select('event_type')
      .eq('organization_id', organizationId);

    const visits = (events || []).filter((e) => e.event_type === 'visit').length;
    const leads = (events || []).filter((e) => e.event_type === 'lead_created').length;
    const jobs = (events || []).filter((e) => e.event_type === 'job_created').length;
    const revenue = (events || []).filter((e) => e.event_type === 'revenue_recorded').length;

    return {
      visits,
      leads,
      jobs,
      revenue,
      visit_to_lead: visits > 0 ? (leads / visits) * 100 : 0,
      lead_to_job: leads > 0 ? (jobs / leads) * 100 : 0,
      job_to_revenue: jobs > 0 ? (revenue / jobs) * 100 : 0,
    };
  }
}
