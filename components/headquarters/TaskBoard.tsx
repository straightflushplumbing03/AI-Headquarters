'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import type { Task, Agent } from '@/types/models'

export function TaskBoard() {
  const params = useParams()
  const organizationId = params.id as string
  const supabase = createClient()

  const [tasks, setTasks] = useState<Task[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [filter, setFilter] = useState<'all' | 'queued' | 'working' | 'completed' | 'failed'>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadTasks = async () => {
      try {
        const { data: tasksData } = await supabase
          .from('tasks')
          .select('*')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })

        const { data: agentsData } = await supabase
          .from('agents')
          .select('*')
          .eq('organization_id', organizationId)

        setTasks(tasksData || [])
        setAgents(agentsData || [])
      } catch (error) {
        console.error('Failed to load tasks:', error)
      } finally {
        setLoading(false)
      }
    }

    loadTasks()

    const subscription = supabase
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
          loadTasks()
        }
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [organizationId, supabase])

  const filteredTasks = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter)

  const getAgentName = (agentId: string) => {
    return agents.find((a) => a.id === agentId)?.name || 'Unknown Agent'
  }

  return (
    <Container className="py-12 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Tasks</h1>
        <Button onClick={() => (window.location.href = `/headquarters/${organizationId}/create-task`)}>
          Create Task
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'queued', 'working', 'completed', 'failed'] as const).map((status) => (
          <Button
            key={status}
            variant={filter === status ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setFilter(status)}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Button>
        ))}
      </div>

      {/* Tasks List */}
      <div className="space-y-3">
        {loading ? (
          <div className="text-center text-slate-400">Loading tasks...</div>
        ) : filteredTasks.length === 0 ? (
          <div className="text-center text-slate-400">No tasks found</div>
        ) : (
          filteredTasks.map((task) => (
            <Card key={task.id} className="p-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold mb-2">{task.title}</h3>
                  {task.description && (
                    <p className="text-slate-400 text-sm mb-3">{task.description}</p>
                  )}
                  <div className="flex gap-4 text-sm">
                    <span className="text-slate-400">Agent: {getAgentName(task.agent_id)}</span>
                    <span className="text-slate-400">Priority: {task.priority}</span>
                    {task.completed_at && (
                      <span className="text-slate-400">
                        Completed: {new Date(task.completed_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className="text-xs px-3 py-1 rounded-full font-semibold whitespace-nowrap"
                  style={{
                    backgroundColor:
                      task.status === 'completed'
                        ? '#10b98120'
                        : task.status === 'working'
                        ? '#3b82f620'
                        : task.status === 'failed'
                        ? '#ef444420'
                        : task.status === 'queued'
                        ? '#f5a50b20'
                        : '#6b728020',
                    color:
                      task.status === 'completed'
                        ? '#10b981'
                        : task.status === 'working'
                        ? '#3b82f6'
                        : task.status === 'failed'
                        ? '#ef4444'
                        : task.status === 'queued'
                        ? '#f59e0b'
                        : '#9ca3af',
                  }}
                >
                  {task.status}
                </span>
              </div>
            </Card>
          ))
        )}
      </div>
    </Container>
  )
}
