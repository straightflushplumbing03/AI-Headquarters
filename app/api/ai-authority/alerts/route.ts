import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
  requireApprover,
} from '@/lib/authority/api-auth'
import { AuthorityStore } from '@/lib/authority/store'

export const dynamic = 'force-dynamic'


/**
 * GET /api/ai-authority/alerts
 *
 * Prioritised alerts detected by monitoring.
 *
 * PATCH /api/ai-authority/alerts
 * Body: { organizationId, alertId, status }
 * Acknowledge or dismiss a single alert. Requires an approver role because
 * acknowledgement is what makes an alert stop surfacing.
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
    const alerts = await store.listAlerts(auth.organizationId, { status, limit })

    return NextResponse.json({ alerts, total: alerts.length })
  } catch (error) {
    return authorityErrorResponse(error, 'alerts')
  }
}

const ALLOWED_ALERT_STATUS = new Set(['acknowledged', 'dismissed'])

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const organizationId = organizationIdFromRequest(request, body)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const approverError = requireApprover(auth)
    if (approverError) return approverError

    const alertId = typeof body?.alertId === 'string' ? body.alertId : null
    const status = typeof body?.status === 'string' ? body.status : null

    if (!alertId) return NextResponse.json({ error: 'alertId is required' }, { status: 400 })
    if (!status || !ALLOWED_ALERT_STATUS.has(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${[...ALLOWED_ALERT_STATUS].join(', ')}` },
        { status: 400 }
      )
    }

    const store = new AuthorityStore(auth.supabase)
    await store.acknowledgeAlert(auth.organizationId, alertId, status)
    await store.logAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: `ai_authority.alert_${status}`,
      resource: `authority_alert:${alertId}`,
      details: `Alert marked ${status}`,
    })

    return NextResponse.json({ success: true, alertId, status })
  } catch (error) {
    return authorityErrorResponse(error, 'alerts.patch')
  }
}
