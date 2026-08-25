import { SupabaseClient } from '@supabase/supabase-js';

export class Phase7LearningOrchestrator {
  constructor(private supabase: SupabaseClient) {}

  async processOutcome(
    organizationId: string,
    decisionId: string,
    actualOutcome: any,
    agentId: string
  ) {
    try {
      await this.supabase
        .from('autonomous_decisions')
        .update({
          execution_status: 'completed',
          actual_outcome: actualOutcome.description,
          success: actualOutcome.success,
          outcome_measured: true,
          actual_revenue_impact: actualOutcome.revenue || 0,
        })
        .eq('id', decisionId);

      return { recorded: true };
    } catch (error) {
      console.error('Learning processing failed:', error);
      throw error;
    }
  }

  async generateLearningReport(organizationId: string) {
    const { data: decisions } = await this.supabase
      .from('autonomous_decisions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('outcome_measured', true)
      .limit(50);

    const successCount = decisions?.filter(d => d.success).length || 0;
    const successRate = decisions?.length ? (successCount / decisions.length) * 100 : 0;

    return {
      decision_count: decisions?.length || 0,
      success_rate: Math.round(successRate),
      generated_at: new Date().toISOString(),
    };
  }
}
