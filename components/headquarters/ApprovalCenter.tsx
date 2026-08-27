'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'

interface ApprovalRecord {
  id: string
  title: string
  description: string | null
  expected_impact: string | null
  risk_assessment: string | null
  estimated_cost?: number | null
  reasoning: string | null
  approval_status: string
  requested_at: string
  response_deadline: string | null
  // joined from linked decision / action
  agent_id?: string | null
}

export function ApprovalCenter() {
  const params = useParams()
  const organizationId = params.id as string

  const [approvals, setApprovals] = useState<ApprovalRecord[]>([])
  const [userRole, setUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState<string | null>(null)
  const [processing, setProcessing] = useState<string | null>(null)

  const loadApprovals = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sprint3/approvals/pending?organizationId=${organizationId}`)
      const json = await res.json()
      if (json.success) {
        setApprovals(json.data ?? [])
        setUserRole(json.userRole ?? null)
      }
    } catch (err) {
      console.error('Failed to load approvals:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadApprovals() }, [organizationId])

  const canActOnApproval = userRole === 'owner' || userRole === 'admin'

  const handleApprove = async (approvalId: string) => {
    setProcessing(approvalId)
    setActionError(null)
    try {
      const res = await fetch(`/api/sprint3/approvals/${approvalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error ?? 'Approval failed'); return }
      await loadApprovals()
    } catch (err: any) {
      setActionError(err.message)
    } finally {
      setProcessing(null)
    }
  }

  const handleReject = async (approvalId: string) => {
    const reason = prompt('Rejection reason (required):')
    if (!reason) return
    setProcessing(approvalId)
    setActionError(null)
    try {
      const res = await fetch(`/api/sprint3/approvals/${approvalId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId, reason }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error ?? 'Rejection failed'); return }
      await loadApprovals()
    } catch (err: any) {
      setActionError(err.message)
    } finally {
      setProcessing(null)
    }
  }

  const handleCancel = async (approvalId: string) => {
    setProcessing(approvalId)
    setActionError(null)
    try {
      const res = await fetch(`/api/sprint3/approvals/${approvalId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId, reason: 'Cancelled via approval center' }),
      })
      const json = await res.json()
      if (!json.success) { setActionError(json.error ?? 'Cancellation failed'); return }
      await loadApprovals()
    } catch (err: any) {
      setActionError(err.message)
    } finally {
      setProcessing(null)
    }
  }

  if (loading) {
    return <div className="text-center text-slate-400 py-12">Loading approvals…</div>
  }

  return (
    <Container className="py-12 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Approval Center</h1>
        <p className="text-slate-400 mt-2">Review and act on AI action approval requests</p>
        {!canActOnApproval && (
          <p className="text-yellow-500 mt-1 text-sm">Your role ({userRole}) does not permit approving or rejecting actions.</p>
        )}
      </div>

      {actionError && (
        <div className="bg-red-900/40 border border-red-500 rounded p-3 text-red-300 text-sm">{actionError}</div>
      )}

      <div className="space-y-4">
        {approvals.length === 0 ? (
          <Card className="text-center py-12">
            <p className="text-slate-400">No pending approvals</p>
          </Card>
        ) : (
          approvals.map((approval) => {
            const isProcessing = processing === approval.id
            const deadline = approval.response_deadline ? new Date(approval.response_deadline) : null
            const expired = deadline ? new Date() > deadline : false

            return (
              <Card key={approval.id} className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold">{approval.title}</h3>
                    <p className="text-slate-400 text-sm">{approval.description}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded font-medium shrink-0 ${
                    expired ? 'bg-yellow-900 text-yellow-300' : 'bg-blue-900 text-blue-300'
                  }`}>
                    {expired ? 'EXPIRED' : approval.approval_status.toUpperCase()}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  {approval.reasoning && (
                    <div className="col-span-2 bg-slate-800 rounded p-3">
                      <p className="text-slate-300 font-medium mb-1">Reason</p>
                      <p className="text-slate-400">{approval.reasoning}</p>
                    </div>
                  )}
                  {approval.expected_impact && (
                    <div>
                      <p className="text-slate-300 font-medium">Expected Impact</p>
                      <p className="text-slate-400">{approval.expected_impact}</p>
                    </div>
                  )}
                  {approval.risk_assessment && (
                    <div>
                      <p className="text-slate-300 font-medium">Risk</p>
                      <p className="text-slate-400">{approval.risk_assessment}</p>
                    </div>
                  )}
                  {approval.estimated_cost != null && (
                    <div>
                      <p className="text-slate-300 font-medium">Est. Cost</p>
                      <p className="text-slate-400">${approval.estimated_cost.toFixed(2)}</p>
                    </div>
                  )}
                  {approval.agent_id && (
                    <div>
                      <p className="text-slate-300 font-medium">Agent</p>
                      <p className="text-slate-400 truncate">{approval.agent_id}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-slate-300 font-medium">Requested</p>
                    <p className="text-slate-400">{new Date(approval.requested_at).toLocaleString()}</p>
                  </div>
                  {deadline && (
                    <div>
                      <p className="text-slate-300 font-medium">Expires</p>
                      <p className={expired ? 'text-yellow-400' : 'text-slate-400'}>{deadline.toLocaleString()}</p>
                    </div>
                  )}
                </div>

                {canActOnApproval && !expired && (
                  <div className="flex gap-3 pt-4 border-t border-slate-700">
                    <Button
                      onClick={() => handleApprove(approval.id)}
                      disabled={isProcessing}
                      className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50"
                    >
                      {isProcessing ? '…' : 'Approve'}
                    </Button>
                    <Button
                      onClick={() => handleReject(approval.id)}
                      disabled={isProcessing}
                      variant="ghost"
                      className="flex-1 disabled:opacity-50"
                    >
                      Reject
                    </Button>
                    <Button
                      onClick={() => handleCancel(approval.id)}
                      disabled={isProcessing}
                      variant="ghost"
                      className="flex-1 text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </Card>
            )
          })
        )}
      </div>
    </Container>
  )
}
