import { SupabaseClient } from '@supabase/supabase-js';

export class ActionExecutionEngine {
  constructor(private supabase: SupabaseClient) {}

  async queueAction(
    organizationId: string,
    decisionId: string,
    actionType: string,
    payload: Record<string, any>,
    authorizationLevel: 'level_1' | 'level_2' | 'level_3' | 'level_4',
    priority: number = 50
  ) {
    const { data: action, error: actionError } = await this.supabase
      .from('autonomous_actions')
      .insert({
        organization_id: organizationId,
        decision_id: decisionId,
        action_type: actionType,
        title: `${actionType}: ${new Date().toISOString()}`,
        payload,
        authorization_level: authorizationLevel,
        execution_status: 'queued',
      })
      .select()
      .single();

    if (actionError) throw actionError;

    await this.supabase
      .from('action_queue')
      .insert({
        organization_id: organizationId,
        action_id: action.id,
        priority,
        queue_status: 'pending',
      });

    return action;
  }

  async executeAction(actionId: string, agentId: string) {
    const { data: action } = await this.supabase
      .from('autonomous_actions')
      .select('*')
      .eq('id', actionId)
      .single();

    if (!action) throw new Error('Action not found');

    await this.supabase
      .from('autonomous_actions')
      .update({
        execution_status: 'executing',
        started_at: new Date().toISOString(),
        executed_by_agent_id: agentId,
      })
      .eq('id', actionId);

    try {
      const result = await this.performAction(action);

      await this.supabase
        .from('autonomous_actions')
        .update({
          execution_status: 'completed',
          completed_at: new Date().toISOString(),
          result,
          success: true,
        })
        .eq('id', actionId);

      return result;
    } catch (error) {
      await this.supabase
        .from('autonomous_actions')
        .update({
          execution_status: 'failed',
          last_error: String(error),
          success: false,
        })
        .eq('id', actionId);

      throw error;
    }
  }

  private async performAction(action: any): Promise<any> {
    const actionType = action.action_type;
    const payload = action.payload;

    switch (actionType) {
      case 'generate_report':
        return { status: 'report_generated', timestamp: new Date().toISOString() };
      case 'create_task':
        return { status: 'task_created', task_id: `task_${Date.now()}` };
      case 'send_alert':
        return { status: 'alert_sent', alert_id: `alert_${Date.now()}` };
      case 'update_priority':
        return { status: 'priority_updated', item_id: payload.item_id };
      default:
        return { status: 'action_executed', type: actionType };
    }
  }
}
