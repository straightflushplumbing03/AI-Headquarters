'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'
import type { Organization, Department } from '@/types/models'

const EMPLOYEE_TEMPLATES = [
  {
    name: 'AI CEO',
    role: 'Chief Executive Officer',
    description: 'Oversees all operations, prioritizes work, manages other AI employees',
    capabilities: ['Strategic Planning', 'Task Assignment', 'Performance Analysis'],
    icon: '👔',
  },
  {
    name: 'Competitor Intelligence Analyst',
    role: 'Analyst',
    description: 'Discovers and monitors competitors, identifies opportunities',
    capabilities: ['Web Research', 'Analysis', 'Reporting'],
    icon: '🔍',
  },
  {
    name: 'SEO Strategist',
    role: 'SEO Specialist',
    description: 'Develops SEO strategy, keyword research, optimization recommendations',
    capabilities: ['SEO Analysis', 'Keyword Research', 'Content Strategy'],
    icon: '📈',
  },
  {
    name: 'Content Strategist',
    role: 'Content Specialist',
    description: 'Develops content strategy, creates content briefs and plans',
    capabilities: ['Content Planning', 'Strategy Development', 'Writing'],
    icon: '✍️',
  },
  {
    name: 'Technical SEO Specialist',
    role: 'Technical Specialist',
    description: 'Analyzes and improves technical website performance',
    capabilities: ['Technical Analysis', 'Performance Optimization', 'Audits'],
    icon: '⚙️',
  },
  {
    name: 'Research Analyst',
    role: 'Analyst',
    description: 'Conducts market and industry research',
    capabilities: ['Research', 'Data Analysis', 'Reporting'],
    icon: '📊',
  },
]

export function HireEmployee() {
  const params = useParams()
  const router = useRouter()
  const organizationId = params.id as string
  const supabase = createClient()

  const [organization, setOrganization] = useState<Organization | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<(typeof EMPLOYEE_TEMPLATES)[0] | null>(null)
  const [customName, setCustomName] = useState('')
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: org } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', organizationId)
          .single()

        setOrganization(org)

        const { data: depts } = await supabase
          .from('departments')
          .select('*')
          .eq('organization_id', organizationId)

        setDepartments(depts || [])
        if (depts && depts.length > 0) {
          setSelectedDepartment(depts[0].id)
        }
      } catch (err: any) {
        setError(err.message)
      }
    }

    loadData()
  }, [organizationId, supabase])

  const handleHireEmployee = async () => {
    if (!selectedTemplate || !customName.trim() || !selectedDepartment) {
      setError('Please select a template, enter a name, and select a department')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { data: agent, error: createError } = await supabase
        .from('agents')
        .insert([
          {
            organization_id: organizationId,
            department_id: selectedDepartment,
            name: customName,
            role: selectedTemplate.role,
            description: selectedTemplate.description,
            capabilities: selectedTemplate.capabilities,
            status: 'available',
            active: true,
          },
        ])
        .select()
        .single()

      if (createError) throw createError

      // Log activity
      await supabase.from('activity_events').insert([
        {
          organization_id: organizationId,
          agent_id: agent.id,
          event_type: 'employee_hired',
          title: `${customName} hired`,
          description: `AI employee ${customName} (${selectedTemplate.role}) has been added to the workforce`,
        },
      ])

      router.push(`/headquarters/${organizationId}`)
    } catch (err: any) {
      setError(err.message || 'Failed to hire employee')
    } finally {
      setLoading(false)
    }
  }

  if (!organization) {
    return (
      <Container className="py-12">
        <div className="text-center">
          <p className="text-slate-400">Loading...</p>
        </div>
      </Container>
    )
  }

  return (
    <Container className="py-12 space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.back()}>
          ← Back
        </Button>
        <h1 className="text-3xl font-bold">Hire AI Employee</h1>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Employee Templates */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-2xl font-bold">Choose Employee Type</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {EMPLOYEE_TEMPLATES.map((template) => (
              <Card
                key={template.role}
                className={`cursor-pointer transition-all ${
                  selectedTemplate?.role === template.role
                    ? 'ring-2 ring-primary-500'
                    : 'hover:border-primary-500/50'
                }`}
                onClick={() => setSelectedTemplate(template)}
              >
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{template.icon}</span>
                    <div>
                      <p className="font-semibold">{template.name}</p>
                      <p className="text-sm text-slate-400">{template.role}</p>
                    </div>
                  </div>
                  <p className="text-sm text-slate-300">{template.description}</p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {template.capabilities.map((cap) => (
                      <span key={cap} className="text-xs bg-slate-800 text-slate-300 px-2 py-1 rounded">
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Configuration */}
        <div className="space-y-6">
          <Card className="space-y-6">
            <h3 className="text-xl font-bold">Configuration</h3>

            {selectedTemplate && (
              <>
                <div>
                  <p className="text-sm text-slate-400 mb-2">Selected Type</p>
                  <p className="font-semibold">{selectedTemplate.name}</p>
                </div>

                <Input
                  label="Employee Name"
                  placeholder={selectedTemplate.name}
                  value={customName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomName(e.target.value)}
                  disabled={loading}
                />

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Department
                  </label>
                  <select
                    className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                    value={selectedDepartment}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedDepartment(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">Select department...</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                </div>

                <Button
                  onClick={handleHireEmployee}
                  disabled={loading || !customName.trim()}
                  className="w-full"
                >
                  {loading ? 'Hiring...' : 'Hire Employee'}
                </Button>
              </>
            )}

            {!selectedTemplate && (
              <p className="text-slate-400 text-sm">Select an employee type to configure</p>
            )}
          </Card>
        </div>
      </div>
    </Container>
  )
}
