'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import type { CompanyGoal } from '@/types/ai'

export function CompanyGoals() {
  const params = useParams()
  const organizationId = params.id as string
  const supabase = createClient()

  const [goals, setGoals] = useState<CompanyGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium' as const,
    targetDate: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadGoals = async () => {
      try {
        const { data } = await supabase
          .from('company_goals')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('status', 'active')
          .order('priority', { ascending: false })

        setGoals(data || [])
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadGoals()
  }, [organizationId, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      if (!formData.title.trim()) {
        throw new Error('Goal title is required')
      }

      const { data, error: insertError } = await supabase
        .from('company_goals')
        .insert([
          {
            organization_id: organizationId,
            title: formData.title,
            description: formData.description,
            priority: formData.priority,
            target_date: formData.targetDate || null,
            status: 'active',
          },
        ])
        .select()

      if (insertError) throw insertError

      if (data) {
        setGoals([...goals, data[0]])
      }

      setFormData({
        title: '',
        description: '',
        priority: 'medium',
        targetDate: '',
      })
      setShowForm(false)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteGoal = async (goalId: string) => {
    try {
      await supabase.from('company_goals').update({ status: 'paused' }).eq('id', goalId)
      setGoals(goals.filter((g) => g.id !== goalId))
    } catch (err: any) {
      setError(err.message)
    }
  }

  const priorityColors = {
    low: 'bg-blue-500/20 text-blue-300',
    medium: 'bg-yellow-500/20 text-yellow-300',
    high: 'bg-orange-500/20 text-orange-300',
    critical: 'bg-red-500/20 text-red-300',
  }

  if (loading) {
    return <div className="text-center text-slate-400">Loading goals...</div>
  }

  return (
    <Container className="py-12 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Company Goals</h1>
          <p className="text-slate-400 mt-2">Guide your AI workforce toward strategic objectives</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'Add Goal'}</Button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {showForm && (
        <Card className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Goal Title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g., Increase SEO rankings"
              disabled={submitting}
            />

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Description</label>
              <textarea
                className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors h-20 resize-none"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the goal..."
                disabled={submitting}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Priority</label>
                <select
                  className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100"
                  value={formData.priority}
                  onChange={(e) =>
                    setFormData({ ...formData, priority: e.target.value as any })
                  }
                  disabled={submitting}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <Input
                label="Target Date"
                type="date"
                value={formData.targetDate}
                onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
                disabled={submitting}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button type="submit" disabled={submitting} className="flex-1">
                {submitting ? 'Creating...' : 'Create Goal'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowForm(false)}
                disabled={submitting}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {goals.length === 0 ? (
          <Card className="text-center py-12">
            <p className="text-slate-400">No active goals yet</p>
            <p className="text-slate-500 text-sm mt-2">Create goals to guide your AI workforce</p>
          </Card>
        ) : (
          goals.map((goal) => (
            <Card key={goal.id} className="p-6 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold">{goal.title}</h3>
                  <p className="text-slate-400 text-sm mt-1">{goal.description}</p>
                </div>
                <span className={`text-xs px-3 py-1 rounded-full font-semibold ${priorityColors[goal.priority]}`}>
                  {goal.priority}
                </span>
              </div>

              {goal.target_date && (
                <p className="text-xs text-slate-400">
                  Target: {new Date(goal.target_date).toLocaleDateString()}
                </p>
              )}

              <div className="flex gap-2 pt-2 border-t border-slate-700">
                <Button
                  onClick={() => handleDeleteGoal(goal.id)}
                  variant="ghost"
                  className="text-red-400 hover:text-red-300 text-sm"
                >
                  Remove
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </Container>
  )
}
