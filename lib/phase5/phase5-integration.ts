import { SupabaseClient } from '@supabase/supabase-js';
import { Phase5 } from '../../types/phase5';
import { PredictiveLeadService } from './predictive-lead-service';
import { RevenueForecastService } from './revenue-forecast-service';
import { OpportunityEngine } from './opportunity-engine';
import { RecommendationEngine } from './recommendation-engine';
import { BusinessHealthService } from './business-health-service';

export class Phase5Integration {
  private leadService: PredictiveLeadService;
  private revenueService: RevenueForecastService;
  private opportunityEngine: OpportunityEngine;
  private recommendationEngine: RecommendationEngine;
  private healthService: BusinessHealthService;

  constructor(supabase: SupabaseClient) {
    this.leadService = new PredictiveLeadService(supabase);
    this.revenueService = new RevenueForecastService(supabase);
    this.opportunityEngine = new OpportunityEngine(supabase);
    this.recommendationEngine = new RecommendationEngine(supabase);
    this.healthService = new BusinessHealthService(supabase);
  }

  async getPredictiveIntelligenceState(organizationId: string): Promise<Phase5.PredictiveIntelligenceState> {
    const leadForecast7d = await this.leadService.forecast7Days(organizationId);
    const revenueForecast30d = await this.revenueService.forecastMonth(organizationId);
    const topOpportunities = await this.opportunityEngine.getTopOpportunities(organizationId, 10);
    const topRecommendations = await this.recommendationEngine.getTopRecommendations(organizationId, 5);
    const businessHealth = await this.healthService.calculateHealthScore(organizationId);

    return {
      predictions: {
        lead_forecast_7days: {
          id: '',
          organization_id: organizationId,
          prediction_type: 'lead_volume',
          timeframe: '7_days',
          prediction_period_start: new Date().toISOString().split('T')[0],
          prediction_period_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          predicted_value: leadForecast7d.prediction,
          confidence: leadForecast7d.confidence,
          unit: 'leads',
          created_at: new Date().toISOString(),
          status: 'active',
        },
        revenue_forecast_30days: {
          id: '',
          organization_id: organizationId,
          prediction_type: 'revenue',
          timeframe: '30_days',
          prediction_period_start: new Date().toISOString().split('T')[0],
          prediction_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          predicted_value: revenueForecast30d.prediction,
          confidence: revenueForecast30d.confidence,
          unit: 'dollars',
          created_at: new Date().toISOString(),
          status: 'active',
        },
      },
      topOpportunities,
      opportunitiesByCategory: {} as any,
      topRecommendations: topRecommendations.map(r => ({ ...r } as any)),
      urgentRecommendations: topRecommendations.filter(r => r.priority === 'critical' || r.priority === 'high').map(r => ({ ...r } as any)),
      approvalPendingRecommendations: [],
      businessHealth,
      healthTrends: [businessHealth],
      activeAlerts: [],
      criticalAlerts: [],
      acknowledgedAlerts: [],
      attributionSummary: {
        top_channels: [],
        conversion_paths: [],
        revenue_by_channel: {},
      },
      modelAccuracy: {},
      lastUpdated: new Date().toISOString(),
    };
  }
}
