import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/supabase'

export async function createTask(
  organizationId: string,
  agentId: string,
  creatorId: string,
  title: string,
  description?: string,
  priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium',
  input?: Record<string, unknown>
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('tasks')
    .insert([
      {
        organization_id: organizationId,
        agent_id: agentId,
        creator_id: creatorId,
        title,
        description,
        priority,
        input,
        status: 'queued',
      },
    ])
    .select()
    .single()

  if (error) throw error

  // Log activity
  await logActivity(
    organizationId,
    agentId,
    creatorId,
    'task_created',
    `Task created: ${title}`,
    null,
    { task_id: data.id, priority }
  )

  return data
}

export async function getTasks(organizationId: string, agentId?: string) {
  const supabase = await createClient()

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('organization_id', organizationId)

  if (agentId) {
    query = query.eq('agent_id', agentId)
  }

  const { data, error } = await query.order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function updateTaskStatus(
  taskId: string,
  status: Database['public']['Tables']['tasks']['Row']['status']
) {
  const supabase = await createClient()

  const updates: any = {
    status,
    updated_at: new Date().toISOString(),
  }

  if (status === 'completed') {
    updates.completed_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', taskId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function logActivity(
  organizationId: string,
  agentId: string | null,
  userId: string | null,
  eventType: string,
  title: string,
  description?: string | null,
  metadata?: Record<string, unknown>
) {
  const supabase = await createClient()

  const { error } = await supabase.from('activity_events').insert([
    {
      organization_id: organizationId,
      agent_id: agentId,
      user_id: userId,
      event_type: eventType,
      title,
      description,
      metadata,
    },
  ])

  if (error) throw error
}

export async function getActivityEvents(
  organizationId: string,
  limit = 50
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('activity_events')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data
}
