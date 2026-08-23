import { Database } from '@/types/supabase'
import { createClient } from '@/lib/supabase/server'

export async function createOrganization(
  name: string,
  slug: string,
  userId: string,
  data?: {
    website?: string
    industry?: string
    description?: string
  }
) {
  const supabase = await createClient()

  // Check if slug already exists
  const { data: existing } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .single()

  if (existing) {
    throw new Error('Organization slug already exists')
  }

  // Create organization
  const { data: organization, error } = await supabase
    .from('organizations')
    .insert([
      {
        name,
        slug,
        website: data?.website,
        industry: data?.industry,
        description: data?.description,
        primary_color: '#0ea5e9',
        secondary_color: '#8b5cf6',
        accent_color: '#06b6d4',
        onboarding_completed: false,
      },
    ])
    .select()
    .single()

  if (error) throw error

  // Add user as owner
  const { error: memberError } = await supabase
    .from('organization_members')
    .insert([
      {
        organization_id: organization.id,
        user_id: userId,
        role: 'owner',
      },
    ])

  if (memberError) throw memberError

  return organization
}

export async function getOrganizationBySlug(slug: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('slug', slug)
    .single()

  if (error) throw error
  return data
}

export async function getUserOrganizations(userId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('organization_members')
    .select('organizations(*)')
    .eq('user_id', userId)

  if (error) throw error
  return data
}

export async function updateOrganization(
  organizationId: string,
  updates: Partial<Database['public']['Tables']['organizations']['Update']>
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('organizations')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', organizationId)
    .select()
    .single()

  if (error) throw error
  return data
}
