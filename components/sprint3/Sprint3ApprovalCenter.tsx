'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Container } from '@/components/Container'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'

interface Sprint3Approval {
  id: string
  decision_id?: string
  title?: string
  reasoning?: string
  expected_impact?: string
  approval_status: string
  requested_at?: string
  response_deadline?: string
}

export function Sprint3ApprovalCenter() {
  const params = useParams()
  const organizationId = params.id as string

  const [approvals, setApprovals] = useState<Sprint3Approval[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch(
        `/api/sprint3/approvals/pending?organizationId=${encodeURIComponent(organizationId)}`
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed to load approvals (${res.status})`)
      }
      const body = await res.json()
      setApprovals(body.data || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [organizationId])

  useEffect(() => {
    load()
  }, [load])

  const act = async (approvalId: string, action: 'approve' | 'reject' | 'cancel') => {
    setBusyId(approvalId)
    try {
      const res = await fetch(`/api/sprint3/approvals/${approvalId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          notes: action === 'approve' ? undefined : `${action}ed via approval center`,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed to ${action} (${res.status})`)
      }
      setApprovals((prev) => prev.filter((a) => a.id !== approvalId))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <Container className="py-12">
        <div className="text-center text-slate-400">Loading pending approvals...</div>
      </Container>
    )
  }

  return (
    <Container className="py-12 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Autonomous Action Approvals</h1>
        <p className="text-slate-400 mt-2">
          Review, approve, or cancel AI-proposed actions. Only Owner and Admin can decide.
        </p>
      </div>

      {error && (
        <Card className="border-red-700 bg-red-950/40">
          <p className="text-sm text-red-300">{error}</p>
          <Button onClick={load} variant="ghost" className="mt-2 text-sm">
            Retry
          </Button>
        </Card>
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
                <h3 className="text-lg font-semibold mb-2">
                  {approval.title || `Approval ${approval.id}`}
                </h3>
                {approval.reasoning && (
                  <p className="text-slate-400 text-sm">{approval.reasoning}</p>
                )}
                {approval.expected_impact && (
                  <p className="text-slate-500 text-sm mt-1">
                    Expected impact: {approval.expected_impact}
                  </p>
                )}
                {approval.response_deadline && (
                  <p className="text-amber-500 text-xs mt-2">
                    Deadline: {new Date(approval.response_deadline).toLocaleString()}
                  </p>
                )}
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-700">
                <Button
                  onClick={() => act(approval.id, 'approve')}
                  disabled={busyId === approval.id}
                  className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50"
                >
                  {busyId === approval.id ? '...' : 'Approve'}
                </Button>
                <Button
                  onClick={() => act(approval.id, 'reject')}
                  disabled={busyId === approval.id}
                  variant="ghost"
                  className="flex-1 disabled:opacity-50"
                >
                  Reject
                </Button>
                <Button
                  onClick={() => act(approval.id, 'cancel')}
                  disabled={busyId === approval.id}
                  variant="ghost"
                  className="flex-1 text-slate-400 disabled:opacity-50"
                >
                  Cancel
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </Container>
  )
}
