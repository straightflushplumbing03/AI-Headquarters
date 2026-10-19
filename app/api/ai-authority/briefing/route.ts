/**
 * GET /api/ai-authority/briefing
 *
 * The concise daily business summary, built at 6:00 AM Pacific by the
 * authority_daily_briefing job and available on demand here.
 *
 * READ-ONLY. Makes no external calls and spends nothing. Every number is an
 * observation the system actually collected; anything uncollected is reported
 * under `unavailable` rather than shown as zero.
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

    const orchestrator = new AuthorityOverviewService(auth.supabase)
    const briefing = await orchestrator.buildDailyBriefing(auth.organizationId, safeWindow)

    return NextResponse.json(briefing)
  } catch (error) {
    return authorityErrorResponse(error, 'briefing')
  }
}
