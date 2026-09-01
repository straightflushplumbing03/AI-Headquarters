/**
 * Phase 5: Predictive Lead Service
 * Forecasts lead volume based on historical data and current pipeline
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { Phase5 } from '../../types/phase5';

export class PredictiveLeadService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Forecast leads for the next 7 days
   */
  async forecast7Days(organizationId: string): Promise<Phase5.PredictionConfidence> {
    const { data: recentLeads } = await this.supabase
      .from('leads')
      .select('created_at')
      .eq('organization_id', organizationId)
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });

    const leadCount = recentLeads?.length ?? 0;
    const dailyAvg = leadCount / 30;
    const predicted = Math.round(dailyAvg * 7);
    const confidence = leadCount > 20 ? 75 : leadCount > 5 ? 55 : 35;
    const dataQuality = leadCount > 30 ? 0.85 : leadCount > 10 ? 0.65 : 0.4;

    await this.storePrediction(organizationId, {
      prediction_type: 'lead_volume',
      timeframe: '7_days',
      prediction_period_start: new Date().toISOString().split('T')[0],
      prediction_period_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      predicted_value: predicted,
      predicted_value_min: Math.round(predicted * 0.75),
      predicted_value_max: Math.round(predicted * 1.25),
      confidence,
      unit: 'leads',
      supporting_data: {
        recent_30d_leads: leadCount,
        daily_average: parseFloat(dailyAvg.toFixed(2)),
      },
      assumptions: ['Lead flow remains consistent', 'No major marketing changes'],
      model_version: 'historical_average_v1',
      prediction_logic: '30-day historical daily average x 7 days',
      data_quality_score: dataQuality,
    });

    return {
      prediction: predicted,
      min: Math.round(predicted * 0.75),
      max: Math.round(predicted * 1.25),
      confidence,
      data_quality: dataQuality,
      data_issues: dataQuality < 0.6 ? ['Insufficient historical lead data'] : [],
      explanation: `Based on ${leadCount} leads in the past 30 days (~${dailyAvg.toFixed(1)}/day), forecasting ~${predicted} leads in the next 7 days`,
    };
  }

  private async storePrediction(
    organizationId: string,
    pred: Omit<Phase5.Prediction, 'id' | 'organization_id' | 'created_at' | 'status'>
  ) {
    await this.supabase.from('predictions').insert({
      organization_id: organizationId,
      ...pred,
      status: 'active',
    });
  }
}
