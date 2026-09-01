'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import type { Organization, Agent, Department } from '@/types/models'

export function CreateTask() {
  const params = useParams()
  const router = useRouter()
  const organizationId = params.id as string
  const supabase = createClient()

  const [_organization, setOrganization] = useState<Organization | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [_departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    agentId: '',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'critical',
  })

  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: org } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', organizationId)
          .single()

        setOrganization(org)

        const { data: agentsData } = await supabase
          .from('agents')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('active', true)

        const { data: deptsData } = await supabase
          .from('departments')
          .select('*')
          .eq('organization_id', organizationId)

        setAgents(agentsData || [])
        setDepartments(deptsData || [])

        if (agentsData && agentsData.length > 0) {
          setFormData((prev) => ({ ...prev, agentId: agentsData[0].id }))
        }
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [organizationId, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.title.trim() || !formData.agentId) {
      setError('Please fill in all required fields')
      return
    }

    setSubmitting(true)

    try {
      const { error: createError } = await supabase.from('tasks').insert([
        {
          organization_id: organizationId,
          agent_id: formData.agentId,
          title: formData.title,
          description: formData.description,
          priority: formData.priority,
          status: 'queued',
        },
      ])

      if (createError) throw createError

      // Log activity
      await supabase.from('activity_events').insert([
        {
          organization_id: organizationId,
          event_type: 'task_created',
          title: `Task created: ${formData.title}`,
          description: `New task assigned to AI employee`,
        },
      ])

      router.push(`/headquarters/${organizationId}/tasks`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="text-center text-slate-400">Loading...</div>
  }

  return (
    <Container className="py-12 max-w-2xl space-y-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.back()}>
          ← Back
        </Button>
        <h1 className="text-3xl font-bold">Create Task</h1>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      <Card className="space-y-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <Input
            label="Task Title"
            placeholder="What should the AI employee do?"
            value={formData.title}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, title: e.target.value })}
            disabled={submitting}
            required
          />

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
            <textarea
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors h-24 resize-none"
              placeholder="Provide detailed instructions..."
              value={formData.description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData({ ...formData, description: e.target.value })}
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Assign To</label>
            <select
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              value={formData.agentId}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFormData({ ...formData, agentId: e.target.value })}
              disabled={submitting}
              required
            >
              <option value="">Select employee...</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Priority</label>
            <select
              className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              value={formData.priority}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setFormData({
                  ...formData,
                  priority: e.target.value as 'low' | 'medium' | 'high' | 'critical',
                })
              }
              disabled={submitting}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>

          <div className="flex gap-4 pt-4 border-t border-slate-700">
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? 'Creating...' : 'Create Task'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.back()}
              disabled={submitting}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </Container>
  )
}
