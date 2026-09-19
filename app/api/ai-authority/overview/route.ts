/**
 * GET /api/ai-authority/overview
 *
 * The Command Center payload: overall internal metrics, engine capabilities,
 * integration status, per-market scores with deltas, top opportunities and
 * open alerts.
 *
 * READ-ONLY. Performs no external calls, so opening the dashboard costs
 * nothing and cannot trigger provider spend.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
} from '@/lib/authority/api-auth'
import { AuthorityOverviewService } from '@/lib/authority/orchestrator'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const windowDays = Number(new URL(request.url).searchParams.get('windowDays') ?? 30)
    const safeWindow = Number.isFinite(windowDays) && windowDays > 0 ? Math.min(windowDays, 365) : 30

    const service = new AuthorityOverviewService(auth.supabase)
    const overview = await service.overview(auth.organizationId, safeWindow)

    return NextResponse.json(overview)
  } catch (error) {
    return authorityErrorResponse(error, 'overview')
  }
}