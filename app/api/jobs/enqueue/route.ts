/**
 * Sprint 5.3 P1: Authenticated job enqueue endpoint
 *
 * POST /api/jobs/enqueue
 * Body: { organizationId, jobType, payload?, idempotencyKey?, delaySeconds? }
 *
 * SECURITY (same posture as /api/ai/execute):
 * - Identity comes ONLY from the session cookie.
 * - Membership in the target organization is verified server-side; the
 *   organization_id in the body is only accepted AFTER the membership check.
 * - The row insert itself is additionally protected by RLS
 *   (background_jobs_org_isolation), so even a buggy membership check cannot
 *   insert into another org's queue.
 * - idempotencyKey defaults to a per-request UUID when omitted — callers who
 *   need dedupe semantics must pass one explicitly.
 * - Only the registered job types are accepted; payload is validated per type.
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { BackgroundJobQueue } from '@/lib/jobs/queue'
import type { BackgroundJobType } from '@/lib/jobs/types'

export const dynamic = 'force-dynamic'

const ALLOWED_JOB_TYPES: BackgroundJobType[] = [
  'approval_expiration_sweep',
  'embedding_backfill',
  'execute_autonomous_action',
]

function validatePayload(jobType: BackgroundJobType, payload: unknown): string | null {
  if (payload === undefined || payload === null) return null
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return 'payload must be a JSON object'
  }
  const p = payload as Record<string, unknown>

  if (jobType === 'execute_autonomous_action') {
    if (typeof p.actionId !== 'string' || p.actionId.length === 0) {
      return 'payload.actionId is required for execute_autonomous_action'
    }
    if (typeof p.idempotencyKey !== 'string' || p.idempotencyKey.length === 0) {
      return 'payload.idempotencyKey is required for execute_autonomous_action'
    }
  }
  if (jobType === 'embedding_backfill') {
    if (p.batchSize !== undefined && (typeof p.batchSize !== 'number' || p.batchSize < 1 || p.batchSize > 100)) {
      return 'payload.batchSize must be a number between 1 and 100'
    }
  }
  // approval_expiration_sweep takes no payload fields.
  return null
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate from session cookie — fail closed.
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse + validate.
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { organizationId, jobType, payload, idempotencyKey, delaySeconds } = body as {
      organizationId?: string
      jobType?: string
      payload?: unknown
      idempotencyKey?: string
      delaySeconds?: number
    }

    if (!organizationId || typeof organizationId !== 'string') {
      return NextResponse.json({ error: 'organizationId is required' }, { status: 400 })
    }
    if (!jobType || !ALLOWED_JOB_TYPES.includes(jobType as BackgroundJobType)) {
      return NextResponse.json(
        { error: `jobType must be one of: ${ALLOWED_JOB_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    const payloadError = validatePayload(jobType as BackgroundJobType, payload)
    if (payloadError) {
      return NextResponse.json({ error: payloadError }, { status: 400 })
    }

    // 3. Server-side membership verification (never trust the body alone).
    const { data: member } = await supabase
      .from('organization_members')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', organizationId)
      .single()
    if (!member) {
      return NextResponse.json({ error: 'Organization access denied' }, { status: 403 })
    }

    // 4. Enqueue with the user-scoped client (RLS enforced again at the DB).
    const queue = new BackgroundJobQueue(supabase)
    const result = await queue.enqueue({
      jobType: jobType as BackgroundJobType,
      organizationId,
      idempotencyKey: idempotencyKey || randomUUID(),
      payload: (payload ?? {}) as Record<string, unknown>,
      delaySeconds: typeof delaySeconds === 'number' && delaySeconds >= 0 ? delaySeconds : 0,
      createdBy: user.id,
    })

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      jobId: result.jobId,
      deduplicated: result.deduplicated,
    })
  } catch (error: any) {
    console.error('[jobs enqueue error]', error?.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
