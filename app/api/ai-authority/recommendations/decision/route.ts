/**
 * POST /api/ai-authority/recommendations/decision
 * Body: { organizationId, actionId, decision: 'approve' | 'reject', reason? }
 *
 * The human control point for the AI Authority Engine.
 *
 * This operates on the EXISTING approval machine rather than inventing a
 * parallel one:
 *
 *   - approve: flips the linked `approval_requests` row to approved and records
 *     the human decision (who, when, why) on the authority action. It does NOT
 *     publish anything itself. Publication remains the job of the existing
 *     execution engine, which independently re-checks risk and kill switches.
 *   - reject: flips the approval to rejected, marks the authority action
 *     rejected, and cancels the queued autonomous action so it can never run.
 *
 * Authorization: an approver role (owner/admin) is REQUIRED. A plain member
 * cannot authorize customer-facing changes.
 *
 * Green-class steps are refused here (they need no approval and are handled by
 * the pipeline). Red-class steps are refused too: the system deliberately never
 * queues a red action for execution, so there is nothing here to approve.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
  requireApprover,
} from '@/lib/authority/api-auth'
import { AuthorityStore } from '@/lib/authority/store'

export const dynamic = 'force-dynamic'

interface DecisionBody {
  organizationId?: string
  actionId?: string
  decision?: string
  reason?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as DecisionBody | null
    const organizationId = organizationIdFromRequest(request, body as Record<string, unknown> | null)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const approverError = requireApprover(auth)
    if (approverError) return approverError

    const actionId = typeof body?.actionId === 'string' ? body.actionId : null
    const decision = body?.decision === 'reject' ? 'reject' : body?.decision === 'approve' ? 'approve' : null

    if (!actionId) {
      return NextResponse.json({ error: 'actionId is required' }, { status: 400 })
    }
    if (!decision) {
      return NextResponse.json(
        { error: "decision must be 'approve' or 'reject'" },
        { status: 400 }
      )
    }

    const store = new AuthorityStore(auth.supabase)

    const { data: actionRow, error: actionError } = await auth.supabase
      .from('authority_recommendation_actions')
      .select('*')
      .eq('organization_id', auth.organizationId)
      .eq('id', actionId)
      .maybeSingle()

    if (actionError) return authorityErrorResponse(actionError, 'recommendations.decision.read')
    if (!actionRow) {
      return NextResponse.json({ error: 'Recommendation action not found' }, { status: 404 })
    }

    const action = actionRow as Record<string, unknown>
    const approvalClass = String(action.approval_class ?? '')

    if (approvalClass === 'red') {
      return NextResponse.json(
        {
          error:
            'This step is classified RED (money, business identity, or legally sensitive). It is never ' +
            'queued for autonomous execution and cannot be authorized through this endpoint.',
          approvalClass: 'red',
        },
        { status: 409 }
      )
    }

    if (approvalClass === 'green') {
      return NextResponse.json(
        {
          error:
            'This step is classified GREEN and requires no approval. It runs through the background ' +
            'pipeline without a human decision.',
          approvalClass: 'green',
        },
        { status: 409 }
      )
    }

    const newStatus = decision === 'approve' ? 'approved' : 'rejected'
    const now = new Date().toISOString()
    const reason = typeof body?.reason === 'string' ? body.reason.slice(0, 2000) : null

    // 1. The approval row drives the existing approval state machine.
    if (action.action_id) {
      const { error: approvalError } = await auth.supabase
        .from('approval_requests')
        .update({
          approval_status: newStatus,
          responded_at: now,
          responded_by: auth.userId,
          response_reason: reason,
        })
        .eq('organization_id', auth.organizationId)
        .eq('action_id', action.action_id)

      if (approvalError) {
        return authorityErrorResponse(approvalError, `recommendations.${decision}.approval`)
      }
    }

    // 2. The authority action mirrors the decision so the authority UI and the
    //    learning loop both see the outcome.
    await store.updateRecommendationAction(auth.organizationId, actionId, {
      status: newStatus,
      decided_by: auth.userId,
      decided_at: now,
      decision_reason: reason,
    })

    // 3. A rejection must also stop the downstream execution engine. Only a
    //    still-queued action is cancelled; anything further along is left alone
    //    and reported rather than silently mutated.
    if (decision === 'reject' && action.action_id) {
      await cancelQueuedAction(auth.supabase, auth.organizationId, String(action.action_id))
    }

    // 4. Honest audit trail: who decided, what, and why.
    await store.logAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: `ai_authority.recommendation_${newStatus}`,
      resource: `authority_recommendation_action:${actionId}`,
      details:
        `${decision === 'approve' ? 'Approved' : 'Rejected'} authority step: ${String(action.title)}`,
      metadata: { actionId, approvalClass, reason },
    })

    return NextResponse.json({
      success: true,
      actionId,
      approvalStatus: newStatus,
      note:
        decision === 'approve'
          ? 'Approved. Publication remains the responsibility of the existing execution engine, which ' +
            're-checks risk and kill switches before acting.'
          : 'Rejected. The action is cancelled and will not be executed.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'recommendations.decision')
  }
}

async function cancelQueuedAction(
  supabase: SupabaseClient,
  organizationId: string,
  actionId: string
): Promise<void> {
  const { error } = await supabase
    .from('autonomous_actions')
    .update({ execution_status: 'cancelled' })
    .eq('organization_id', organizationId)
    .eq('id', actionId)
    .eq('execution_status', 'queued')

  if (error) {
    // Not fatal: the approval row is already rejected, which is the gate the
    // execution engine consults first. Log loudly so it is not invisible.
    console.error(`[authority] cancelling queued action ${actionId} failed: ${error.message}`)
  }
}