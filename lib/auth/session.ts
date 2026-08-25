import { createClient } from '@/lib/supabase/server'
import type { User } from '@supabase/supabase-js'

export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user || null
}

export async function requireAuth() {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('Unauthorized: User not authenticated')
  }
  return user
}

export async function getUserOrganizations(userId: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('organization_members')
    .select('organization_id, role')
    .eq('user_id', userId)
  
  if (error) throw error
  return data || []
}

export async function verifyOrgAccess(userId: string, organizationId: string): Promise<boolean> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('organization_members')
    .select('id')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .single()
  
  if (error) return false
  return !!data
}

export async function verifyOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('organization_members')
    .select('role')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .in('role', ['owner', 'admin'])
    .single()
  
  if (error) return false
  return !!data
}
