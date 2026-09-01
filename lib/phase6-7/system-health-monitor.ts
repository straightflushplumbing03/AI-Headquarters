import { SupabaseClient } from '@supabase/supabase-js';

export class SystemHealthMonitor {
  constructor(private supabase: SupabaseClient) {}

  async checkSystemHealth(organizationId: string) {
    const checks = {
      predictions: await this.checkPredictionHealth(organizationId),
      agents: await this.checkAgentHealth(organizationId),
      data: await this.checkDataHealth(organizationId),
      performance: await this.checkPerformance(organizationId),
    };

    const allHealthy = Object.values(checks).every(c => c.healthy);

    return {
      overall_healthy: allHealthy,
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkPredictionHealth(organizationId: string) {
    const { data: outcomes } = await this.supabase
      .from('forecast_outcomes')
      .select('accuracy_score')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(20);

    const avgAccuracy = outcomes ? outcomes.reduce((sum, o) => sum + (o.accuracy_score || 0), 0) / outcomes.length : 0;

    return {
      healthy: avgAccuracy > 60,
      accuracy: Math.round(avgAccuracy),
      samples: outcomes?.length || 0,
    };
  }

  private async checkAgentHealth(organizationId: string) {
    const { data: agents } = await this.supabase
      .from('agents')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('active', true);

    return {
      healthy: (agents?.length || 0) > 0,
      active_agents: agents?.length || 0,
    };
  }

  private async checkDataHealth(organizationId: string) {
    const { data: kpis } = await this.supabase
      .from('business_kpis')
      .select('id')
      .eq('organization_id', organizationId);

    return {
      healthy: (kpis?.length || 0) > 0,
      kpi_count: kpis?.length || 0,
    };
  }

  private async checkPerformance(_organizationId: string) {
    return {
      healthy: true,
      status: 'operational',
    };
  }
}
