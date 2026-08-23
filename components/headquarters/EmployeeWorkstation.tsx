'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'
import type { Agent } from '@/types/models'

export function EmployeeWorkstation() {
  const params = useParams()
  const agentId = params.agentId as string
  const supabase = createClient()

  const [agent, setAgent] = useState<Agent | null>(null)
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: agentData } = await supabase
          .from('agents')
          .select('*')
          .eq('id', agentId)
          .single()

        setAgent(agentData)

        const { data: tasksData } = await supabase
          .from('tasks')
          .select('*')
          .eq('agent_id', agentId)
          .order('created_at', { ascending: false })
          .limit(20)

        setTasks(tasksData || [])
      } catch (error) {
        console.error('Failed to load workstation:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [agentId, supabase])

  if (loading || !agent) {
    return (
      <Container className="py-12">
        <div className="text-center text-slate-400">Loading workstation...</div>
      </Container>
    )
  }

  const completedTasks = tasks.filter((t) => t.status === 'completed')
  const failedTasks = tasks.filter((t) => t.status === 'failed')
  const averageCompletionTime = completedTasks.length > 0
    ? Math.round(
        completedTasks.reduce((acc, t) => {
          if (t.started_at && t.completed_at) {
            return (
              acc +
              (new Date(t.completed_at).getTime() -
                new Date(t.started_at).getTime())
            )
          }
          return acc
        }, 0) / completedTasks.length / 1000 / 60
      )
    : 0

  return (
    <Container className="py-12 space-y-8">
      {/* Employee Header */}
      <div className="flex items-center gap-6">
        <div className="text-6xl">{agent.avatar_url || '👤'}</div>
        <div>
          <h1 className="text-4xl font-bold">{agent.name}</h1>
          <p className="text-xl text-slate-400">{agent.role}</p>
          <div className="flex items-center gap-2 mt-3">
            <div
              className="w-3 h-3 rounded-full"
              style={{
                backgroundColor:
                  agent.status === 'available'
                    ? '#10b981'
                    : agent.status === 'working'
                    ? '#f59e0b'
                    : '#6b7280',
              }}
            />
            <span className="text-sm text-slate-300 capitalize">{agent.status}</span>
          </div>
        </div>
      </div>

      {/* Description */}
      {agent.description && (
        <Card>
          <p className="text-slate-300">{agent.description}</p>
        </Card>
      )}

      {/* Capabilities */}
      {agent.capabilities && agent.capabilities.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">Capabilities</h2>
          <div className="flex flex-wrap gap-2">
            {agent.capabilities.map((cap) => (
              <span key={cap} className="bg-primary-600/20 text-primary-300 px-3 py-1 rounded-full text-sm">
                {cap}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Performance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <div className="space-y-2">
            <p className="text-slate-400 text-sm">Total Tasks</p>
            <p className="text-3xl font-bold">{tasks.length}</p>
          </div>
        </Card>
        <Card>
          <div className="space-y-2">
            <p className="text-slate-400 text-sm">Completed</p>
            <p className="text-3xl font-bold text-green-400">{completedTasks.length}</p>
          </div>
        </Card>
        <Card>
          <div className="space-y-2">
            <p className="text-slate-400 text-sm">Failed</p>
            <p className="text-3xl font-bold text-red-400">{failedTasks.length}</p>
          </div>
        </Card>
        <Card>
          <div className="space-y-2">
            <p className="text-slate-400 text-sm">Avg Time (min)</p>
            <p className="text-3xl font-bold">{averageCompletionTime}</p>
          </div>
        </Card>
      </div>

      {/* Recent Tasks */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Recent Tasks</h2>
        <div className="space-y-2">
          {tasks.slice(0, 10).map((task) => (
            <Card key={task.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold">{task.title}</p>
                  <p className="text-sm text-slate-400 mt-1">{task.description}</p>
                </div>
                <span
                  className="text-xs px-2 py-1 rounded-full font-semibold whitespace-nowrap"
                  style={{
                    backgroundColor:
                      task.status === 'completed'
                        ? '#10b98120'
                        : task.status === 'failed'
                        ? '#ef444420'
                        : '#6b728020',
                    color:
                      task.status === 'completed'
                        ? '#10b981'
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
    </Container>
  )
}
