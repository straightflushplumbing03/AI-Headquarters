import { SupabaseClient } from '@supabase/supabase-js';

export class AutonomousWorkflowEngine {
  constructor(private supabase: SupabaseClient) {}

  async createWorkflow(
    organizationId: string,
    name: string,
    steps: any[],
    triggerEvents: string[],
    requireApprovalPerStep: boolean = false
  ) {
    const { data, error } = await this.supabase
      .from('autonomous_workflows')
      .insert({
        organization_id: organizationId,
        name,
        description: `Workflow: ${name}`,
        steps,
        step_count: steps.length,
        trigger_events: triggerEvents,
        status: 'active',
        require_approval_per_step: requireApprovalPerStep,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async executeWorkflow(workflowId: string, organizationId: string, triggerEvent: string) {
    const { data: workflow } = await this.supabase
      .from('autonomous_workflows')
      .select('*')
      .eq('id', workflowId)
      .eq('organization_id', organizationId)
      .single();

    if (!workflow) throw new Error('Workflow not found');

    const { data: execution, error } = await this.supabase
      .from('autonomous_workflow_executions')
      .insert({
        organization_id: organizationId,
        workflow_id: workflowId,
        execution_status: 'running',
        current_step: 0,
        total_steps: workflow.step_count,
        started_at: new Date().toISOString(),
        triggered_by_event: triggerEvent,
      })
      .select()
      .single();

    if (error) throw error;

    await this.executeSteps(execution.id, workflow.steps);

    return execution;
  }

  private async executeSteps(executionId: string, steps: any[]) {
    for (let i = 0; i < steps.length; i++) {
      await this.supabase
        .from('autonomous_workflow_executions')
        .update({ current_step: i + 1 })
        .eq('id', executionId);
    }

    await this.supabase
      .from('autonomous_workflow_executions')
      .update({
        execution_status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', executionId);
  }
}
