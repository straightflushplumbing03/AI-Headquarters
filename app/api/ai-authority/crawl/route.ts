/**
 * POST /api/ai-authority/crawl
 * Body: { organizationId, siteOrigin?, maxPages? }
 *
 * Queue a website crawl.
 *
 * The crawl runs as a durable background job so it inherits locking, retries
 * and the global kill switch. It is queued rather than run inline because a
 * polite crawl of a real site takes minutes, far longer than a request should
 * hold.
 *
 * The crawler itself honours robots.txt, rate-limits every request, identifies
 * itself, caps the page count, and never follows off-site links.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateAuthorityRequest,
  authorityErrorResponse,
  isAuthFailure,
  organizationIdFromRequest,
  requireApprover,
} from '@/lib/authority/api-auth'
import { AuthorityStore } from '@/lib/authority/store'
import { BackgroundJobQueue } from '@/lib/jobs/queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const organizationId = organizationIdFromRequest(request, body)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const approverError = requireApprover(auth)
    if (approverError) return approverError

    const payload: Record<string, unknown> = {}

    if (typeof body?.siteOrigin === 'string' && body.siteOrigin.length > 0) {
      // Validate before it reaches the crawler so a malformed origin is a clear
      // 400 rather than a crawl that silently does nothing.
      try {
        const parsed = new URL(body.siteOrigin)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return NextResponse.json({ error: 'siteOrigin must be http or https' }, { status: 400 })
        }
        payload.siteOrigin = `${parsed.protocol}//${parsed.host}`
      } catch {
        return NextResponse.json({ error: 'siteOrigin is not a valid URL' }, { status: 400 })
      }
    }

    const maxPages = Number(body?.maxPages)
    if (Number.isFinite(maxPages) && maxPages > 0) {
      payload.maxPages = Math.min(Math.round(maxPages), 500)
    }

    const queue = new BackgroundJobQueue(auth.supabase)
    const result = await queue.enqueue({
      jobType: 'authority_website_crawl',
      organizationId: auth.organizationId,
      idempotencyKey: `authority-crawl-manual-${Date.now()}`,
      payload,
      createdBy: auth.userId,
    })

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    const store = new AuthorityStore(auth.supabase)
    await store.logAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: 'ai_authority.crawl_requested',
      resource: `background_job:${result.jobId}`,
      details: 'Manual website crawl requested',
      metadata: payload,
    })

    return NextResponse.json({
      success: true,
      jobId: result.jobId,
      note:
        'Crawl queued. It observes robots.txt and rate limits, so a full crawl may take several minutes.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'crawl')
  }
}