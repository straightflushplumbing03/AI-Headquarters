'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import type { Organization, Agent, Task } from '@/types/models'

export function ExecutiveDashboard() {
  const params = useParams()
  const organizationId = params.id as string
  const supabase = createClient()

  const [organization, setOrganization] = useState<Organization | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [stats, setStats] = useState({
    totalEmployees: 0,
    tasksCompleted: 0,
    tasksInProgress: 0,
    tasksFailed: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        // Load organization
        const { data: org } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', organizationId)
          .single()

        setOrganization(org)

        // Load agents
        const { data: agentsData } = await supabase
          .from('agents')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('active', true)

        setAgents(agentsData || [])

        // Load recent tasks
        const { data: tasksData } = await supabase
          .from('tasks')
          .select('*')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(50)

        setTasks(tasksData || [])

        // Calculate stats
        if (tasksData) {
          setStats({
            totalEmployees: agentsData?.length || 0,
            tasksCompleted: tasksData.filter((t) => t.status === 'completed').length,
            tasksInProgress: tasksData.filter(
              (t) => t.status === 'working' || t.status === 'queued'
            ).length,
            tasksFailed: tasksData.filter((t) => t.status === 'failed').length,
          })
        }
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadData()

    // Subscribe to real-time updates
    const tasksSubscription = supabase
      .channel(`tasks:${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          loadData()
        }
      )
      .subscribe()

    return () => {
      tasksSubscription.unsubscribe()
    }
  }, [organizationId, supabase])

  if (loading) {
    return (
      <Container className="py-12">
        <div className="text-center">
          <p className="text-slate-400">Loading dashboard...</p>
        </div>
      </Container>
    )
  }

  if (error || !organization) {
    return (
      <Container className="py-12">
        <div className="text-center">
          <p className="text-red-400">{error || 'Failed to load dashboard'}</p>
        </div>
      </Container>
    )
  }

  return (
    <Container className="py-12 space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <h1 className="text-4xl font-bold">{organization.name}</h1>
        <p className="text-slate-400">Executive Dashboard</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <div className="space-y-2">
            <p className="text-slate-400 text-sm">AI Employees</p>
            <p className="text-4xl font-bold">{stats.totalEmployees}</p>
            <p className="text-xs text-slate-500">Active workforce</p>
          </div>
        </Card>
        <Card>
          <div className="space-y-2">
            <p className="text-slate-400 text-sm">Completed Tasks</p>
            <p className="text-4xl font-bold text-green-400">{stats.tasksCompleted}</p>
            <p className="text-xs text-slate-500">This period</p>
          </div>
        </Card>
        <Card>
          <div className="space-y-2">
            <p className="text-slate-400 text-sm">In Progress</p>
            <p className="text-4xl font-bold text-blue-400">{stats.tasksInProgress}</p>
            <p className="text-xs text-slate-500">Active tasks</p>
          </div>
        </Card>
        <Card>
          <div className="space-y-2">
            <p className="text-slate-400 text-sm">Failed Tasks</p>
            <p className="text-4xl font-bold text-red-400">{stats.tasksFailed}</p>
            <p className="text-xs text-slate-500">Requires attention</p>
          </div>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex gap-4">
        <Button onClick={() => window.location.href = `/headquarters/${organizationId}`}>
          View Headquarters
        </Button>
        <Button variant="secondary" onClick={() => window.location.href = `/headquarters/${organizationId}/hire`}>
          Hire AI Employee
        </Button>
      </div>

      {/* Recent Tasks */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Recent Tasks</h2>
        <div className="space-y-2">
          {tasks.slice(0, 10).map((task) => (
            <Card key={task.id} className="py-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold">{task.title}</p>
                  <p className="text-sm text-slate-400">{task.description}</p>
                </div>
                <span
                  className="text-xs px-2 py-1 rounded-full font-semibold"
                  style={{
                    backgroundColor:
                      task.status === 'completed'
                        ? '#10b98120'
                        : task.status === 'working'
                        ? '#3b82f620'
                        : task.status === 'failed'
                        ? '#ef444420'
                        : '#6b728020',
                    color:
                      task.status === 'completed'
                        ? '#10b981'
                        : task.status === 'working'
                        ? '#3b82f6'
                        : task.status === 'failed'
                        ? '#ef4444'
                        : '#9ca3af',
                  }}
                >
                  {task.status}
                </span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* AI Employees */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">AI Employees</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.slice(0, 6).map((agent) => (
            <Card key={agent.id} className="py-4">
              <div className="space-y-2">
                <p className="font-semibold">{agent.name}</p>
                <p className="text-sm text-slate-400">{agent.role}</p>
                <div className="flex items-center gap-2 pt-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{
                      backgroundColor:
                        agent.status === 'available'
                          ? '#10b981'
                          : agent.status === 'working'
                          ? '#f59e0b'
                          : '#6b7280',
                    }}
                  />
                  <span className="text-xs text-slate-500 capitalize">{agent.status}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </Container>
  )
}
