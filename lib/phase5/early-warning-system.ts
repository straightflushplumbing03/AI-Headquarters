import { SupabaseClient } from '@supabase/supabase-js';
import { Phase5 } from '../../types/phase5';

export class EarlyWarningSystem {
  constructor(private supabase: SupabaseClient) {}

  async detectRisks(organizationId: string): Promise<Phase5.PredictiveAlert[]> {
    const alerts: Omit<Phase5.PredictiveAlert, 'id' | 'created_at'>[] = [];

    const { data: kpis } = await this.supabase
      .from('business_kpis')
      .select('name, value, previous_value')
      .eq('organization_id', organizationId)
      .ilike('name', '%revenue%');

    if (kpis && kpis.length > 0) {
      const current = parseFloat(kpis[0].value || '0');
      const previous = parseFloat(kpis[0].previous_value || '0');

      if (previous > 0 && (current / previous) < 0.85) {
        alerts.push({
          organization_id: organizationId,
          alert_type: 'revenue_risk',
          severity: 'high',
          title: 'Revenue Decline Detected',
          description: `Revenue down ${Math.round(((1 - current / previous) * 100))}%`,
          evidence: { current, previous },
          confidence: 85,
          status: 'new',
          alert_created_at: new Date().toISOString(),
        });
      }
    }

    for (const alert of alerts) {
      await this.supabase.from('predictive_alerts').insert(alert);
    }

    return alerts as Phase5.PredictiveAlert[];
  }
}
