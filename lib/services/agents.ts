import { createClient } from '@/lib/supabase/server'

export async function createAgent(
  organizationId: string,
  name: string,
  role: string,
  departmentId?: string,
  description?: string,
  capabilities?: string[]
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('agents')
    .insert([
      {
        organization_id: organizationId,
        department_id: departmentId,
        name,
        role,
        description,
        capabilities,
        status: 'available',
        active: true,
      },
    ])
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getAgents(organizationId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .order('created_at')

  if (error) throw error
  return data
}

export async function getAgent(agentId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .single()

  if (error) throw error
  return data
}

export async function updateAgent(
  agentId: string,
  updates: Record<string, any>
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('agents')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', agentId)
    .select()
    .single()

  if (error) throw error
  return data
}
