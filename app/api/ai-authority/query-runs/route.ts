/**
 * POST /api/ai-authority/query-runs
 * Body: { organizationId, limit?, marketId?, engineKey?, mode?: 'monitor' | 'parse' | 'full' }
 *
 * Trigger monitoring on demand.
 *
 * This is the ONLY authority endpoint that can cause provider spend, so it is
 * deliberately gated:
 *   - approver role required (a plain member cannot spend the org's budget)
 *   - the request is turned into a BACKGROUND JOB rather than executed inline,
 *     so the durable queue's idempotency, retry, locking and kill-switch gates
 *     all apply
 *   - the actual spend decision is still made per query inside the runner
 *     (daily/monthly limits, cost ceilings, per-query ceiling)
 *
 * It never bypasses the budget system, and it never invents results for an
 * engine that is unconfigured.
 *
 * GET /api/ai-authority/query-runs
 * Lists recent runs with their outcomes, including honest skips.
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
import type { BackgroundJobType } from '@/lib/jobs/types'

export const dynamic = 'force-dynamic'

const MODE_TO_JOB: Record<string, BackgroundJobType> = {
  monitor: 'authority_query_execution',
  parse: 'authority_response_parsing',
  competitor: 'authority_competitor_monitor',
  score: 'authority_scoring',
  recommend: 'authority_recommendation_generation',
  crawl: 'authority_website_crawl',
  full: 'authority_query_execution',
}

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const url = new URL(request.url)
    const status = url.searchParams.get('status') as
      | 'pending'
      | 'running'
      | 'completed'
      | 'failed'
      | 'skipped'
      | null
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1), 500)

    const store = new AuthorityStore(auth.supabase)
    const runs = await store.listRecentRuns(auth.organizationId, {
      limit,
      status: status ?? undefined,
    })

    const byStatus: Record<string, number> = {}
    for (const run of runs) byStatus[run.status] = (byStatus[run.status] ?? 0) + 1

    return NextResponse.json({
      runs,
      totals: byStatus,
      note:
        'A skipped run means no data was collected AND no cost was incurred for that query/engine pair. ' +
        'Skipped is not a failure, and it is never replaced with fabricated content.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'query-runs.list')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const organizationId = organizationIdFromRequest(request, body)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const approverError = requireApprover(auth)
    if (approverError) return approverError

    const mode = typeof body?.mode === 'string' ? body.mode : 'full'
    const jobType = MODE_TO_JOB[mode]
    if (!jobType) {
      return NextResponse.json(
        { error: `mode must be one of: ${Object.keys(MODE_TO_JOB).join(', ')}` },
        { status: 400 }
      )
    }

    const limit = Number(body?.limit)
    const payload: Record<string, unknown> = {}
    if (Number.isFinite(limit) && limit > 0) payload.limit = Math.min(Math.round(limit), 200)
    if (typeof body?.marketId === 'string') payload.marketId = body.marketId
    if (typeof body?.engineKey === 'string') payload.engineKey = body.engineKey

    // A manual trigger is a distinct logical event, so it carries a unique key.
    // The daily scheduled sweep keeps its own date-bucket key; the two do not
    // collide, and each run is still individually deduplicated inside the runner
    // by (query, engine, day).
    const idempotencyKey = `authority-manual-${mode}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`

    const queue = new BackgroundJobQueue(auth.supabase)
    const result = await queue.enqueue({
      jobType,
      organizationId: auth.organizationId,
      idempotencyKey,
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
      action: 'ai_authority.manual_run_requested',
      resource: `background_job:${result.jobId}`,
      details: `Requested ${mode} run`,
      metadata: { mode, jobType, payload },
    })

    return NextResponse.json({
      success: true,
      jobId: result.jobId,
      mode,
      jobType,
      note:
        'Queued. Budget limits, kill switches, and per-query deduplication are still enforced when the ' +
        'job runs, so this request may collect less than the full amount.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'query-runs.create')
  }
}