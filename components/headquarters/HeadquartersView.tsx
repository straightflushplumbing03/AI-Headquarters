'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import type { Organization, Agent, Department } from '@/types/models'
import { HeadquartersExterior } from '@/components/headquarters/HeadquartersExterior'
import { HeadquartersInterior } from '@/components/headquarters/HeadquartersInterior'
import { Container } from '@/components/Container'
import { Button } from '@/components/Button'

type View = 'exterior' | 'interior'

export function HeadquartersView() {
  const params = useParams()
  const router = useRouter()
  const supabase = createClient()
  const organizationId = params.id as string

  const [view, setView] = useState<View>('exterior')
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        // Verify user has access to this organization
        const { data: member } = await supabase
          .from('organization_members')
          .select('id')
          .eq('organization_id', organizationId)
          .single()

        if (!member) {
          router.push('/onboarding')
          return
        }

        // Load organization
        const { data: org, error: orgError } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', organizationId)
          .single()

        if (orgError) throw orgError
        setOrganization(org)

        // Load departments
        const { data: depts, error: deptsError } = await supabase
          .from('departments')
          .select('*')
          .eq('organization_id', organizationId)
          .order('name')

        if (deptsError) throw deptsError
        setDepartments(depts || [])

        // Load agents
        const { data: agentsData, error: agentsError } = await supabase
          .from('agents')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('active', true)

        if (agentsError) throw agentsError
        setAgents(agentsData || [])
      } catch (err: any) {
        setError(err.message || 'Failed to load headquarters')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [organizationId, supabase, router])

  if (loading) {
    return (
      <Container className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Loading headquarters...</h2>
        </div>
      </Container>
    )
  }

  if (error || !organization) {
    return (
      <Container className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4 text-red-400">Error</h2>
          <p className="text-slate-400 mb-6">{error || 'Headquarters not found'}</p>
          <Button onClick={() => router.push('/onboarding')}>Return to Onboarding</Button>
        </div>
      </Container>
    )
  }

  return (
    <div className="min-h-screen" style={{
      background: `linear-gradient(135deg, ${organization.primary_color}20 0%, ${organization.secondary_color}20 100%)`,
    }}>
      {view === 'exterior' ? (
        <HeadquartersExterior
          organization={organization}
          onEnter={() => setView('interior')}
        />
      ) : (
        <HeadquartersInterior
          organization={organization}
          departments={departments}
          agents={agents}
          onExit={() => setView('exterior')}
        />
      )}
    </div>
  )
}
