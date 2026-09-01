import { SupabaseClient } from '@supabase/supabase-js';

export class Phase6Orchestrator {
  constructor(private supabase: SupabaseClient) {}

  async orchestrateDecisionToAction(
    organizationId: string,
    decisionInput: any,
    _agentId: string
  ) {
    try {
      const { data: decision } = await this.supabase
        .from('autonomous_decisions')
        .insert({
          organization_id: organizationId,
          decision_type: decisionInput.decisionType,
          title: decisionInput.title,
          description: decisionInput.description,
          reasoning: decisionInput.reasoning,
          confidence_score: decisionInput.confidenceScore || 75,
          confidence_level: 'high',
          approval_level: 'controlled',
          execution_status: 'queued',
        })
        .select()
        .single();

      if (!decision) throw new Error('Decision creation failed');

      const { data: action } = await this.supabase
        .from('autonomous_actions')
        .insert({
          organization_id: organizationId,
          decision_id: decision.id,
          action_type: decisionInput.actionType,
          title: `Execute: ${decisionInput.title}`,
          payload: decisionInput,
          authorization_level: 'level_2',
          execution_status: 'completed',
        })
        .select()
        .single();

      return {
        status: 'executed',
        decisionId: decision.id,
        actionId: action?.id,
      };
    } catch (error) {
      console.error('Orchestration failed:', error);
      throw error;
    }
  }
}
