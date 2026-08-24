import { SupabaseClient } from '@supabase/supabase-js'
import type { ScheduledJob } from '@/types/phase3'

/**
 * Job Scheduler
 * Manages recurring and scheduled AI tasks
 */
export class JobScheduler {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create a scheduled job
   */
  async scheduleJob(
    organizationId: string,
    agentId: string,
    jobType: string,
    frequency: 'daily' | 'weekly' | 'monthly' | 'on_demand',
    taskTemplate: Record<string, any>
  ): Promise<ScheduledJob> {
    // Calculate next run time
    const nextRunAt = this.calculateNextRun(frequency)

    const { data, error } = await this.supabase
      .from('scheduled_jobs')
      .insert([
        {
          organization_id: organizationId,
          agent_id: agentId,
          job_type: jobType,
          frequency,
          next_run_at: nextRunAt,
          status: 'active',
          max_duration_minutes: 60,
          task_template: taskTemplate,
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get jobs due to run
   */
  async getJobsDueToRun(organizationId?: string): Promise<ScheduledJob[]> {
    const now = new Date().toISOString()

    let query = this.supabase
      .from('scheduled_jobs')
      .select('*')
      .eq('status', 'active')
      .lte('next_run_at', now)

    if (organizationId) {
      query = query.eq('organization_id', organizationId)
    }

    const { data } = await query.order('next_run_at', { ascending: true })

    return data || []
  }

  /**
   * Mark job as run
   */
  async markJobAsRun(jobId: string, frequency: string): Promise<void> {
    const nextRunAt = this.calculateNextRun(frequency as any)

    await this.supabase
      .from('scheduled_jobs')
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: nextRunAt,
      })
      .eq('id', jobId)
  }

  /**
   * Pause a job
   */
  async pauseJob(jobId: string): Promise<void> {
    await this.supabase.from('scheduled_jobs').update({ status: 'paused' }).eq('id', jobId)
  }

  /**
   * Resume a job
   */
  async resumeJob(jobId: string): Promise<void> {
    const nextRunAt = new Date().toISOString()
    await this.supabase
      .from('scheduled_jobs')
      .update({ status: 'active', next_run_at: nextRunAt })
      .eq('id', jobId)
  }

  /**
   * Delete a job
   */
  async deleteJob(jobId: string): Promise<void> {
    await this.supabase.from('scheduled_jobs').update({ status: 'archived' }).eq('id', jobId)
  }

  /**
   * Calculate next run time based on frequency
   */
  private calculateNextRun(frequency: 'daily' | 'weekly' | 'monthly' | 'on_demand'): string {
    const now = new Date()

    switch (frequency) {
      case 'daily':
        now.setDate(now.getDate() + 1)
        now.setHours(6, 0, 0, 0) // 6 AM next day
        return now.toISOString()

      case 'weekly':
        now.setDate(now.getDate() + 7)
        now.setHours(6, 0, 0, 0)
        return now.toISOString()

      case 'monthly':
        now.setMonth(now.getMonth() + 1)
        now.setDate(1)
        now.setHours(6, 0, 0, 0)
        return now.toISOString()

      case 'on_demand':
        return new Date(Date.now() + 1000).toISOString() // 1 second from now

      default:
        return now.toISOString()
    }
  }
}
