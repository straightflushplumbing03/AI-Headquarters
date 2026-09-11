'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import type { Organization } from '@/types/models'

export function ApprovalCenter() {
  const params = useParams()
  const organizationId = params.id as string
  const supabase = createClient()

  const [_organization, setOrganization] = useState<Organization | null>(null)
  const [approvals, setApprovals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: org } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', organizationId)
          .single()

        setOrganization(org)

        // Load tasks waiting for approval
        const { data: tasksData } = await supabase
          .from('tasks')
          .select('*')
          .eq('organization_id', organizationId)
          .eq('status', 'waiting_approval')
          .order('created_at', { ascending: false })

        setApprovals(tasksData || [])
      } catch (error) {
        console.error('Failed to load approvals:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [organizationId, supabase])

  const handleApprove = async (taskId: string) => {
    try {
      await supabase
        .from('tasks')
        .update({ status: 'queued' })
        .eq('id', taskId)

      setApprovals((prev) => prev.filter((t) => t.id !== taskId))
    } catch (error) {
      console.error('Failed to approve:', error)
    }
  }

  const handleReject = async (taskId: string) => {
    try {
      await supabase
        .from('tasks')
        .update({ status: 'cancelled' })
        .eq('id', taskId)

      setApprovals((prev) => prev.filter((t) => t.id !== taskId))
    } catch (error) {
      console.error('Failed to reject:', error)
    }
  }

  if (loading) {
    return <div className="text-center text-slate-400">Loading...</div>
  }

  return (
    <Container className="py-12 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Approval Center</h1>
        <p className="text-slate-400 mt-2">Review and approve AI employee recommendations</p>
      </div>

      <div className="space-y-4">
        {approvals.length === 0 ? (
          <Card className="text-center py-12">
            <p className="text-slate-400">No pending approvals</p>
          </Card>
        ) : (
          approvals.map((approval) => (
            <Card key={approval.id} className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">{approval.title}</h3>
                <p className="text-slate-400">{approval.description}</p>
              </div>

              {approval.result && (
                <div className="bg-slate-800 rounded-lg p-4 space-y-2">
                  <p className="text-sm font-semibold text-slate-300">Recommendation:</p>
                  <p className="text-slate-300 text-sm">{approval.result}</p>
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-slate-700">
                <Button
                  onClick={() => handleApprove(approval.id)}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  Approve
                </Button>
                <Button
                  onClick={() => handleReject(approval.id)}
                  variant="ghost"
                  className="flex-1"
                >
                  Reject
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </Container>
  )
}
