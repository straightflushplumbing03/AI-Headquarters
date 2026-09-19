import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
} from '@/lib/authority/api-auth'
import { AuthorityStore } from '@/lib/authority/store'

export const dynamic = 'force-dynamic'


/**
 * GET /api/ai-authority/recommendations
 *
 * Recommendations and their ordered action steps, joined with the approval
 * state so the UI can show exactly what is waiting on a human.
 *
 * READ-ONLY.
 */
export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const url = new URL(request.url)
    const marketId = url.searchParams.get('marketId') ?? undefined
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500)

    const store = new AuthorityStore(auth.supabase)
    const [actions, opportunities] = await Promise.all([
      store.listRecommendationActions(auth.organizationId, { limit }),
      store.listOpportunities(auth.organizationId, { limit }),
    ])

    const { data: approvals } = await auth.supabase
      .from('approval_requests')
      .select('id, action_id, approval_status, title, response_deadline, created_at')
      .eq('organization_id', auth.organizationId)
      .order('created_at', { ascending: false })
      .limit(500)

    const approvalByAction = new Map(
      (approvals ?? []).map((a) => [String(a.action_id), a as Record<string, unknown>])
    )

    const opportunityById = new Map(
      opportunities.map((o) => [String(o.id), o as Record<string, unknown>])
    )

    const filtered = marketId ? actions.filter((a) => a.market_id === marketId) : actions

    return NextResponse.json({
      recommendations: filtered.map((action) => {
        const opportunity = opportunityById.get(String(action.opportunity_id))
        return {
          ...action,
          opportunity: opportunity
            ? {
                title: opportunity.title,
                category: opportunity.category,
                what: opportunity.what,
                why: opportunity.why,
                impact: opportunity.impact,
                risk: opportunity.risk,
                measurement: opportunity.measurement,
                opportunityScore: opportunity.opportunity_score,
                scoreExplanation: opportunity.score_explanation,
              }
            : null,
          approval: approvalByAction.get(String(action.action_id ?? '')) ?? null,
        }
      }),
      pendingApprovalCount: (approvals ?? []).filter((a) => a.approval_status === 'pending').length,
    })
  } catch (error) {
    return authorityErrorResponse(error, 'recommendations')
  }
}
