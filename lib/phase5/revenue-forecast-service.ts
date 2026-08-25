/**
 * Phase 5: Revenue Forecast Service
 * Projects revenue based on lead volume, conversion rates, and historical performance
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { Phase5 } from '../../types/phase5';

export class RevenueForecastService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Forecast monthly revenue
   */
  async forecastMonth(organizationId: string): Promise<Phase5.PredictionConfidence> {
    const { data: completedJobs } = await this.supabase
      .from('tasks')
      .select('created_at, metadata')
      .eq('organization_id', organizationId)
      .eq('status', 'completed')
      .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

    const { data: revenueKpis } = await this.supabase
      .from('business_kpis')
      .select('value, previous_value')
      .eq('organization_id', organizationId)
      .eq('kpi_type', 'business')
      .ilike('name', '%revenue%')
      .order('last_updated', { ascending: false })
      .limit(12);

    const avgRevenuePerJob = revenueKpis && revenueKpis.length > 0
      ? parseFloat(revenueKpis[0].value || '0') / (completedJobs?.length || 1)
      : 0;

    const estimatedMonthlyLeads = Math.round((completedJobs?.length || 0) / 3);
    const conversionRate = revenueKpis && revenueKpis.length > 2 ? 0.35 : 0.3;
    const estimatedJobs = Math.round(estimatedMonthlyLeads * conversionRate);
    const projectedRevenue = Math.round(estimatedJobs * avgRevenuePerJob);

    const confidence = revenueKpis && revenueKpis.length > 6 ? 72 : 45;
    const dataQuality = revenueKpis && revenueKpis.length > 12 ? 0.8 : 0.55;

    await this.storePrediction(organizationId, {
      prediction_type: 'revenue',
      timeframe: 'monthly',
      prediction_period_start: new Date().toISOString().split('T')[0],
      prediction_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      predicted_value: projectedRevenue,
      predicted_value_min: Math.round(projectedRevenue * 0.8),
      predicted_value_max: Math.round(projectedRevenue * 1.2),
      confidence,
      unit: 'dollars',
      supporting_data: {
        estimated_leads: estimatedMonthlyLeads,
        estimated_jobs: estimatedJobs,
        avg_revenue_per_job: parseFloat(avgRevenuePerJob.toFixed(2)),
        conversion_rate: parseFloat((conversionRate * 100).toFixed(1)),
      },
      assumptions: [
        'Stable conversion rate',
        'No major market changes',
        'Historical revenue patterns continue',
      ],
      model_version: 'lead_based_revenue_v1',
      prediction_logic: 'Estimated monthly leads x conversion rate x average revenue per job',
      data_quality_score: dataQuality,
    });

    return {
      prediction: projectedRevenue,
      min: Math.round(projectedRevenue * 0.8),
      max: Math.round(projectedRevenue * 1.2),
      confidence,
      data_quality: dataQuality,
      data_issues: dataQuality < 0.7 ? ['Limited historical revenue data'] : [],
      explanation: `Estimated ${estimatedMonthlyLeads} leads x ${parseFloat((conversionRate * 100).toFixed(0))}% conversion = ${estimatedJobs} jobs x $${parseFloat(avgRevenuePerJob.toFixed(0))} avg job = ~$${projectedRevenue.toLocaleString()} projected monthly revenue`,
    };
  }

  /**
   * Forecast quarterly revenue
   */
  async forecastQuarter(organizationId: string): Promise<Phase5.PredictionConfidence> {
    const monthlyForecast = await this.forecastMonth(organizationId);
    const quarterlyRevenue = Math.round(monthlyForecast.prediction * 3);

    await this.storePrediction(organizationId, {
      prediction_type: 'revenue',
      timeframe: 'quarterly',
      prediction_period_start: new Date().toISOString().split('T')[0],
      prediction_period_end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      predicted_value: quarterlyRevenue,
      predicted_value_min: Math.round(monthlyForecast.min * 3),
      predicted_value_max: Math.round(monthlyForecast.max * 3),
      confidence: monthlyForecast.confidence - 5,
      unit: 'dollars',
      supporting_data: {
        based_on_monthly_forecast: monthlyForecast.prediction,
        months: 3,
      },
      assumptions: ['Monthly revenue remains stable', 'No significant seasonal variations'],
      model_version: 'lead_based_revenue_v1',
      prediction_logic: 'Monthly forecast x 3',
      data_quality_score: monthlyForecast.data_quality * 0.9,
    });

    return {
      prediction: quarterlyRevenue,
      min: Math.round(monthlyForecast.min * 3),
      max: Math.round(monthlyForecast.max * 3),
      confidence: monthlyForecast.confidence - 5,
      data_quality: monthlyForecast.data_quality * 0.9,
      data_issues: monthlyForecast.data_issues,
      explanation: `Q forecast: ${quarterlyRevenue.toLocaleString()} (${Math.round(quarterlyRevenue / 3).toLocaleString()}/month)`,
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
