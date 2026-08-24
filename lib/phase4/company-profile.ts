import { SupabaseClient } from '@supabase/supabase-js'
import type { CompanyProfile } from '@/types/phase4'

/**
 * Company Profile Service
 * Manages organization context and strategic information
 */
export class CompanyProfileService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Initialize company profile
   */
  async initializeProfile(
    organizationId: string,
    profile: Omit<CompanyProfile, 'id' | 'organization_id' | 'created_at' | 'updated_at'>
  ): Promise<CompanyProfile> {
    const { data, error } = await this.supabase
      .from('company_profiles')
      .insert([
        {
          ...profile,
          organization_id: organizationId,
        },
      ])
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Get company profile
   */
  async getProfile(organizationId: string): Promise<CompanyProfile | null> {
    const { data } = await this.supabase
      .from('company_profiles')
      .select('*')
      .eq('organization_id', organizationId)
      .single()

    return data || null
  }

  /**
   * Update company profile
   */
  async updateProfile(
    organizationId: string,
    updates: Partial<Omit<CompanyProfile, 'id' | 'organization_id' | 'created_at'>>
  ): Promise<CompanyProfile> {
    const { data, error } = await this.supabase
      .from('company_profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .select()
      .single()

    if (error) throw error
    return data
  }

  /**
   * Add to strategic objectives
   */
  async addStrategicObjective(organizationId: string, objective: string): Promise<CompanyProfile> {
    const profile = await this.getProfile(organizationId)
    if (!profile) throw new Error('Profile not found')

    const objectives = profile.strategic_objectives || []
    if (!objectives.includes(objective)) {
      objectives.push(objective)
    }

    return this.updateProfile(organizationId, {
      strategic_objectives: objectives,
    })
  }

  /**
   * Get strategic context for agents
   */
  async getStrategicContext(organizationId: string): Promise<string> {
    const profile = await this.getProfile(organizationId)
    if (!profile) return ''

    return `
Organization: ${profile.company_name}
Brand Position: ${profile.brand_position}
Primary Specialties: ${profile.primary_specialties?.join(', ')}
Strategic Market: ${profile.strategic_market}
Service Areas: ${profile.service_areas?.join(', ')}
Brand Values: ${profile.brand_values?.join(', ')}
Key Competitors: ${profile.primary_competitors?.join(', ')}
Strategic Objectives: ${profile.strategic_objectives?.join(', ')}

Context: ${profile.company_context}
    `.trim()
  }
}
