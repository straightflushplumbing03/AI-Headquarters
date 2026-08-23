import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/browser'
import type { Organization } from '@/types/models'

export function useOrganization(organizationId?: string) {
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    if (!organizationId) {
      setLoading(false)
      return
    }

    const getOrganization = async () => {
      try {
        const { data, error } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', organizationId)
          .single()

        if (error) throw error
        setOrganization(data)
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to fetch organization')
      } finally {
        setLoading(false)
      }
    }

    getOrganization()
  }, [organizationId, supabase])

  return { organization, loading, error }
}
