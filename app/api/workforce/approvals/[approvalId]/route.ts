/**
 * Phase A: owner decision on a workforce approval request.
 *
 * POST /api/workforce/approvals/:approvalId
 * Body: { decision: 'approved' | 'rejected', note? }
 *
 * The decision is made by workforce_decide_approval under the caller's own
 * session: only an owner or admin of the approval's organization can decide,
 * the decision and the reviewer are recorded as an event, and the gated task
 * is released (approved) or cancelled (rejected). The executor still
 * re-checks the approval and the agent's grant at execution time.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decideApproval, WorkforceError } from '@/lib/workforce/service'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: { approvalId: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!/^[0-9a-f-]{36}$/i.test(params.approvalId)) {
    return NextResponse.json({ error: 'Invalid approval id' }, { status: 400 })
  }

  let body: { decision?: unknown; note?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 })
  }
  if (body.decision !== 'approved' && body.decision !== 'rejected') {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 })
  }
  if (body.note !== undefined && typeof body.note !== 'string') {
    return NextResponse.json({ error: 'note must be a string' }, { status: 400 })
  }

  try {
    const result = await decideApproval(supabase as any, params.approvalId, body.decision, body.note as string | undefined)
    if (!result.ok) {
      const status = result.reason === 'forbidden' ? 403 : 409
      return NextResponse.json({ error: result.reason, ...result }, { status })
    }
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof WorkforceError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    return NextResponse.json({ error: 'Workforce request failed' }, { status: 500 })
  }
}
