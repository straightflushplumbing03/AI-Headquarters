import { createClient } from '@/lib/supabase/server'

export async function createDepartment(
  organizationId: string,
  name: string,
  color: string,
  positionX: number,
  positionY: number,
  description?: string,
  icon?: string
) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('departments')
    .insert([
      {
        organization_id: organizationId,
        name,
        color,
        position_x: positionX,
        position_y: positionY,
        description,
        icon,
      },
    ])
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getDepartments(organizationId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('departments')
    .select('*')
    .eq('organization_id', organizationId)
    .order('name')

  if (error) throw error
  return data
}

export async function initializeDefaultDepartments(organizationId: string) {
  const departments = [
    { name: 'Executive', color: '#0ea5e9', x: 50, y: 20, icon: '👔' },
    { name: 'Marketing', color: '#8b5cf6', x: 20, y: 50, icon: '📢' },
    { name: 'Research', color: '#06b6d4', x: 80, y: 50, icon: '🔬' },
    { name: 'SEO', color: '#14b8a6', x: 20, y: 80, icon: '🔍' },
    { name: 'Technology', color: '#f59e0b', x: 50, y: 80, icon: '💻' },
    { name: 'Operations', color: '#ef4444', x: 80, y: 80, icon: '⚙️' },
  ]

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('departments')
    .insert(
      departments.map((dept) => ({
        organization_id: organizationId,
        name: dept.name,
        color: dept.color,
        position_x: dept.x,
        position_y: dept.y,
        icon: dept.icon,
      }))
    )
    .select()

  if (error) throw error
  return data
}
