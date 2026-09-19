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
 * GET /api/ai-authority/opportunities
 *
 * Ranked opportunities. Each row carries its full score breakdown and the
 * WHAT / WHY / EVIDENCE / IMPACT / ACTION / RISK / APPROVAL / MEASUREMENT
 * explanation, because an opportunity a human cannot interrogate is not
 * actionable.
 *
 * READ-ONLY.
 */
export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const url = new URL(request.url)
    const status = url.searchParams.get('status') ?? undefined
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500)

    const store = new AuthorityStore(auth.supabase)
    const opportunities = await store.listOpportunities(auth.organizationId, { status, limit })

    return NextResponse.json({
      opportunities,
      policy:
        'opportunity_score is a Business Brain PRIORITISATION HEURISTIC over our own observations. ' +
        'It is not, and must never be presented as, a Google, OpenAI, or any other platform score.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'opportunities')
  }
}
