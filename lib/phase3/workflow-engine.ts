import { SupabaseClient } from '@supabase/supabase-js'
import type {
  TaskWorkflow,
  WorkflowExecution,
} from '@/types/phase3'

/**
 * Workflow Engine
 * Manages multi-step workflows with dependencies and execution tracking
 */
export class WorkflowEngine {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create workflow template
   */
  async createWorkflow(
    organizationId: string,
    workflow: Omit<TaskWorkflow, 'id' | 'created_at' | 'updated_at'>
  ): Promise<TaskWorkflow> {
    const { data, error } = await this.supabase
      .from('task_workflows')
      .insert([{ ...workflow, organization_id: organizationId }])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Execute workflow
   */
  async executeWorkflow(
    organizationId: string,
    workflowId: string,
    initiatedByAgentId: string,
    executionContext?: Record<string, any>
  ): Promise<WorkflowExecution> {
    // Get workflow
    const workflow = await this.getWorkflow(workflowId)
    if (!workflow) throw new Error('Workflow not found')

    // Create execution record
    const { data: execution, error } = await this.supabase
      .from('workflow_executions')
      .insert([
        {
          organization_id: organizationId,
          workflow_id: workflowId,
          initiated_by: initiatedByAgentId,
          status: 'running',
          current_step: 0,
          total_steps: workflow.steps.length,
          execution_context: executionContext || {},
          error_log: [],
          total_cost: 0,
        },
      ])
      .select()
      .single()

    if (error) throw error
    return execution
  }

  /**
   * Execute next step in workflow
   */
  async executeNextStep(
    executionId: string,
    stepResult: { success: boolean; data?: any; error?: string; cost: number }
  ): Promise<WorkflowExecution> {
    // Get execution
    const { data: execution } = await this.supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single()

    if (!execution) throw new Error('Execution not found')

    // Update execution
    const updates: Record<string, any> = {
      current_step: execution.current_step + 1,
      total_cost: execution.total_cost + stepResult.cost,
      updated_at: new Date().toISOString(),
    }

    // Handle error
    if (!stepResult.success && stepResult.error) {
      updates.error_log = [...(execution.error_log || []), stepResult.error]
      if (execution.current_step === execution.total_steps - 1) {
        updates.status = 'failed'
        updates.completed_at = new Date().toISOString()
      }
    }

    // Check if workflow is complete
    if (execution.current_step >= execution.total_steps - 1) {
      updates.status = 'completed'
      updates.completed_at = new Date().toISOString()
    }

    const { data } = await this.supabase
      .from('workflow_executions')
      .update(updates)
      .eq('id', executionId)
      .select()
      .single()

    return data
  }

  /**
   * Get workflow
   */
  async getWorkflow(workflowId: string): Promise<TaskWorkflow | null> {
    const { data } = await this.supabase
      .from('task_workflows')
      .select('*')
      .eq('id', workflowId)
      .single()

    return data || null
  }

  /**
   * Get workflow execution
   */
  async getExecution(executionId: string): Promise<WorkflowExecution | null> {
    const { data } = await this.supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single()

    return data || null
  }

  /**
   * Cancel workflow execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    await this.supabase
      .from('workflow_executions')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', executionId)
  }

  /**
   * Get execution history for workflow
   */
  async getExecutionHistory(
    workflowId: string,
    limit: number = 10
  ): Promise<WorkflowExecution[]> {
    const { data } = await this.supabase
      .from('workflow_executions')
      .select('*')
      .eq('workflow_id', workflowId)
      .order('started_at', { ascending: false })
      .limit(limit)

    return data || []
  }
}
