'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'
import type { ActivityEvent } from '@/types/models'

export function ActivityFeed() {
  const params = useParams()
  const organizationId = params.id as string
  const supabase = createClient()

  const [activities, setActivities] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadActivities = async () => {
      try {
        const { data } = await supabase
          .from('activity_events')
          .select('*')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false })
          .limit(100)

        setActivities(data || [])
      } catch (error) {
        console.error('Failed to load activities:', error)
      } finally {
        setLoading(false)
      }
    }

    loadActivities()

    const subscription = supabase
      .channel(`activities:${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'activity_events',
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          setActivities((prev) => [payload.new as ActivityEvent, ...prev])
        }
      )
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [organizationId, supabase])

  const getEventIcon = (eventType: string) => {
    const icons: Record<string, string> = {
      onboarding_completed: '🏢',
      employee_hired: '👤',
      task_created: '📝',
      task_completed: '✅',
      task_failed: '❌',
      employee_paused: '⏸️',
      employee_activated: '▶️',
    }
    return icons[eventType] || '📌'
  }

  return (
    <Container className="py-12 space-y-8">
      <h1 className="text-3xl font-bold">Activity Feed</h1>

      <div className="space-y-3">
        {loading ? (
          <div className="text-center text-slate-400">Loading activities...</div>
        ) : activities.length === 0 ? (
          <div className="text-center text-slate-400">No activities yet</div>
        ) : (
          activities.map((activity) => (
            <Card key={activity.id} className="p-4">
              <div className="flex gap-4">
                <span className="text-2xl">{getEventIcon(activity.event_type)}</span>
                <div className="flex-1">
                  <p className="font-semibold">{activity.title}</p>
                  <p className="text-sm text-slate-400 mt-1">{activity.description}</p>
                  <p className="text-xs text-slate-500 mt-2">
                    {new Date(activity.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </Container>
  )
}
