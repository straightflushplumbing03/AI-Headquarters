import type { Database } from '@/types/supabase'

export type Organization = Database['public']['Tables']['organizations']['Row']
export type OrganizationMember = Database['public']['Tables']['organization_members']['Row']
export type Department = Database['public']['Tables']['departments']['Row']
export type Agent = Database['public']['Tables']['agents']['Row']
export type Task = Database['public']['Tables']['tasks']['Row']
export type ActivityEvent = Database['public']['Tables']['activity_events']['Row']
export type CompanyMemory = Database['public']['Tables']['company_memory']['Row']
