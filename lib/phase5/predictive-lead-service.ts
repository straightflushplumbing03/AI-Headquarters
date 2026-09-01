/**
 * Phase 5: Predictive Lead Service
 * Forecasts lead volume based on historical data and trends
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { Phase5 } from '../../types/phase5';

export class PredictiveLeadService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Forecast lead volume for the next 7 days
   */
  async forecast7Days(organizationId: string): Promise<Phase5.PredictionConfidence> {
    const { data: recentLeads } = await this.supabase
      .from('leads')
      .select('created_at')
      .eq('organization_id', organizationId)
      .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true });

    const leadCount = recentLeads?.length ?? 0;
    const dailyAvg = leadCount / 90;
    const predicted = Math.round(dailyAvg * 7);
    const confidence = leadCount >= 30 ? 75 : leadCount >= 10 ? 55 : 35;
    const dataQuality = Math.min(1, leadCount / 90);

    return {
      prediction: predicted,
      min: Math.max(0, Math.round(predicted * 0.7)),
      max: Math.round(predicted * 1.4),
      confidence,
      data_quality: dataQuality,
      data_issues: leadCount < 10 ? ['Insufficient historical lead data for accurate forecast'] : [],
      explanation: leadCount >= 10
        ? `Based on ${leadCount} leads over the last 90 days (avg ${dailyAvg.toFixed(1)}/day), projecting ${predicted} leads over 7 days`
        : 'Insufficient data — forecast based on minimal historical records',
    };
  }
}
