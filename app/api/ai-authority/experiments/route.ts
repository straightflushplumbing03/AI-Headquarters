/**
 * GET  /api/ai-authority/experiments   -- list experiments with results
 * POST /api/ai-authority/experiments   -- create a draft experiment with baseline
 *
 * An experiment is a controlled before/after measurement. Creation requires an
 * approver role because it is an intentional change of direction that will later
 * be reported on.
 *
 * The baseline is captured at creation and never rewritten, so the comparison
 * cannot be quietly re-based to make a change look better.
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
import { AuthorityExperimentService } from '@/lib/authority/experiment-service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const organizationId = organizationIdFromRequest(request)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const store = new AuthorityStore(auth.supabase)
    const status = new URL(request.url).searchParams.get('status') ?? undefined
    const experiments = await store.listExperiments(auth.organizationId, status)

    const withResults = await Promise.all(
      experiments.map(async (experiment) => {
        const row = experiment as Record<string, unknown>
        const results = await store.listExperimentResults(
          auth.organizationId,
          String(row.id)
        )
        return { ...row, results }
      })
    )

    return NextResponse.json({
      experiments: withResults,
      interpretation:
        'A result reports what was OBSERVED after a change, never that the change caused it. ' +
        'Inconclusive is a valid and common outcome and is reported honestly.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'experiments.list')
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

    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const hypothesis = typeof body?.hypothesis === 'string' ? body.hypothesis.trim() : ''
    const changeDescription =
      typeof body?.changeDescription === 'string' ? body.changeDescription.trim() : ''

    if (!name || !hypothesis || !changeDescription) {
      return NextResponse.json(
        { error: 'name, hypothesis, and changeDescription are required' },
        { status: 400 }
      )
    }

    const baseline = (body?.baseline ?? {}) as Record<string, unknown>
    const plannedDurationDays = Number(body?.plannedDurationDays)
    const store = new AuthorityStore(auth.supabase)
    const service = new AuthorityExperimentService(store)

    const experiment = await service.create({
      organizationId: auth.organizationId,
      marketId: typeof body?.marketId === 'string' ? body.marketId : null,
      opportunityId: typeof body?.opportunityId === 'string' ? body.opportunityId : null,
      name,
      hypothesis,
      changeDescription,
      changeType: typeof body?.changeType === 'string' ? body.changeType : 'content_update',
      metric: typeof body?.metric === 'string' ? body.metric : 'internal_visibility_score',
      plannedDurationDays:
        Number.isFinite(plannedDurationDays) && plannedDurationDays > 0
          ? Math.min(Math.round(plannedDurationDays), 365)
          : 30,
      baseline,
      createdBy: auth.userId,
    })

    if (!experiment) {
      return NextResponse.json({ error: 'Could not create experiment' }, { status: 500 })
    }

    await store.logAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: 'ai_authority.experiment_created',
      resource: `authority_experiment:${String((experiment as Record<string, unknown>).id)}`,
      details: `Created experiment "${name}"`,
      metadata: { hypothesis, changeDescription, marketId: body?.marketId ?? null },
    })

    return NextResponse.json({ success: true, experiment })
  } catch (error) {
    return authorityErrorResponse(error, 'experiments.create')
  }
}