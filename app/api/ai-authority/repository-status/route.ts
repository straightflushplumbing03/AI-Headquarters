/**
 * GET /api/ai-authority/repository-status
 *
 * Read-only view of the configured repository: default-branch head, CI result,
 * and open pull requests. This is the "did the change actually ship?" check the
 * daily briefing points at.
 *
 * Unlike the briefing this DOES make external calls, so it is a deliberate
 * request rather than part of a page render. It issues GET requests only and
 * reports honestly when the token or repo is not configured.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
} from '@/lib/authority/api-auth'
import { RepositoryStatusService } from '@/lib/authority/repository-status'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const service = new RepositoryStatusService(auth.supabase)
    const result = await service.fetch(auth.organizationId)

    return NextResponse.json({
      provider: result.provider,
      status: result.status,
      message: result.message,
      missingEnvVars: result.missingEnvVars,
      snapshot: result.snapshot,
      policy:
        'Read-only. Only GET requests are issued. An unavailable token or repo is reported as ' +
        'unavailable; CI status is never assumed to be green.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'repository-status')
  }
}
