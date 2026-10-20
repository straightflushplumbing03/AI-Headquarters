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

        // Pending workforce approval requests (recorded by the engine when an
        // agent's grant requires owner approval for a specific action).
        const { data: approvalData } = await supabase
          .from('approval_requests')
          .select('id, title, description, requested_action, scope, created_at, expires_at, task_id, tasks(title)')
          .eq('organization_id', organizationId)
          .eq('status', 'pending')
          .not('requested_action', 'is', null)
          .order('created_at', { ascending: false })

        setApprovals(approvalData || [])
      } catch (error) {
        console.error('Failed to load approvals:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [organizationId, supabase])

  // Decisions go through the enforced server path; the database checks the
  // reviewer's role and records the decision. Hiding a button is not access control.
  const decide = async (approvalId: string, decision: 'approved' | 'rejected') => {
    setError(null)
    try {
      const res = await fetch(`/api/workforce/approvals/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error === 'forbidden' ? 'Only an owner or admin can decide approvals.' : body.error || 'Decision failed')
        return
      }
      setApprovals((prev) => prev.filter((a) => a.id !== approvalId))
    } catch (err) {
      console.error('Failed to record decision:', err)
      setError('Decision failed')
    }
  }

  const handleApprove = (approvalId: string) => decide(approvalId, 'approved')
  const handleReject = (approvalId: string) => decide(approvalId, 'rejected')

  if (loading) {
    return <div className="text-center text-slate-400">Loading...</div>
  }

  return (
    <Container className="py-12 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Approval Center</h1>
        <p className="text-slate-400 mt-2">Review and approve AI employee recommendations</p>
      </div>

      {error && (
        <Card className="border border-red-700 text-red-300 text-sm">{error}</Card>
      )}

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

              <div className="bg-slate-800 rounded-lg p-4 space-y-1 text-sm text-slate-300">
                <p>
                  <span className="font-semibold">Task:</span> {approval.tasks?.title ?? approval.task_id}
                </p>
                <p>
                  <span className="font-semibold">Action:</span> {approval.requested_action} on {approval.scope}
                </p>
                <p className="text-slate-400">
                  Expires {new Date(approval.expires_at).toLocaleString()}
                </p>
              </div>

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
