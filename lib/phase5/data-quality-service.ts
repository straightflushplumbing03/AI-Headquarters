import { SupabaseClient } from '@supabase/supabase-js';

export class DataQualityService {
  constructor(private supabase: SupabaseClient) {}

  async assessPredictionReadiness(organizationId: string): Promise<{
    score: number;
    issues: string[];
    ready: boolean;
  }> {
    let score = 0.8;
    const issues: string[] = [];

    const { count: taskCount } = await this.supabase
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    if ((taskCount || 0) < 10) {
      score -= 0.3;
      issues.push('Insufficient task data');
    }

    const { count: kpiCount } = await this.supabase
      .from('business_kpis')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    if ((kpiCount || 0) < 5) {
      score -= 0.2;
      issues.push('Insufficient KPI data');
    }

    return {
      score: Math.max(0, score),
      issues,
      ready: score > 0.6,
    };
  }
}
