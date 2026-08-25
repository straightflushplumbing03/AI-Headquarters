import { SupabaseClient } from '@supabase/supabase-js'

export async function verifyFounderAccess(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'founder')
    .single()
  return !!data
}

export async function getUserRole(
  supabase: SupabaseClient,
  userId: string,
  organizationId?: string
): Promise<string | null> {
  const { data: founderRole } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'founder')
    .single()

  if (founderRole) return 'founder'

  if (organizationId) {
    const { data: orgRole } = await supabase
      .from('organization_members')
      .select('role')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .single()
    return orgRole?.role || null
  }

  return null
}

export async function hasFounderPermission(supabase: SupabaseClient, userId: string, permission: string): Promise<boolean> {
  const role = await getUserRole(supabase, userId)
  if (role !== 'founder') return false

  const founderPermissions = new Set([
    'view:all_organizations',
    'view:all_agents',
    'manage:ai_providers',
    'manage:cost_controls',
    'manage:emergency_stop',
  ])

  return founderPermissions.has(permission)
}
