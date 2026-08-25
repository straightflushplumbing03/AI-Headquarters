import { SupabaseClient } from '@supabase/supabase-js';

export class AgentPerformanceIntelligence {
  constructor(private supabase: SupabaseClient) {}

  async trackAgentPerformance(
    organizationId: string,
    agentId: string,
    taskType: string,
    success: boolean,
    executionTime: number,
    outcome?: string
  ) {
    const { data, error } = await this.supabase
      .from('agent_performance')
      .insert({
        organization_id: organizationId,
        agent_id: agentId,
        task_type: taskType,
        success,
        execution_time_seconds: executionTime,
        outcome,
        metric_date: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async getAgentStats(organizationId: string, agentId: string) {
    const { data: performance } = await this.supabase
      .from('agent_performance')
      .select('success, execution_time_seconds')
      .eq('organization_id', organizationId)
      .eq('agent_id', agentId)
      .order('metric_date', { ascending: false })
      .limit(100);

    if (!performance || performance.length === 0) {
      return { successRate: 0, avgExecutionTime: 0, taskCount: 0 };
    }

    const successCount = performance.filter(p => p.success).length;
    const avgExecutionTime = performance.reduce((sum, p) => sum + (p.execution_time_seconds || 0), 0) / performance.length;

    return {
      successRate: Math.round((successCount / performance.length) * 100),
      avgExecutionTime: Math.round(avgExecutionTime),
      taskCount: performance.length,
    };
  }
}
