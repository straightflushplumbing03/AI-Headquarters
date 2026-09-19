/**
 * POST /api/ai-authority/seed
 * Body: { organizationId }
 *
 * Initialise the AI Authority taxonomy for an organization.
 *
 * The engine's dashboard is empty until the taxonomy exists: cities, services,
 * the city x service market matrix, engine registrations, query templates,
 * budget ceilings, and unconfigured integration records. None of that is
 * fabricated business evidence -- it is configuration.
 *
 * This is an explicit, idempotent, approver-only action rather than an implicit
 * side effect of loading a page, because it writes taxonomy rows that later
 * analysis depends on. Running it twice is safe: every insert is
 * ON CONFLICT DO NOTHING.
 *
 * The underlying function runs with INVOKER rights and is therefore subject to
 * RLS, so it can only ever seed an organization the caller genuinely belongs to.
 * The membership check below is the first line of defence; RLS is the second.
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

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const organizationId = organizationIdFromRequest(request, body)
    const auth = await authenticateAuthorityRequest(organizationId)
    if (isAuthFailure(auth)) return auth.response

    const approverError = requireApprover(auth)
    if (approverError) return approverError

    const { data, error } = await auth.supabase.rpc('seed_ai_authority_engine', {
      p_organization_id: auth.organizationId,
    })

    if (error) return authorityErrorResponse(error, 'seed')

    const store = new AuthorityStore(auth.supabase)
    await store.logAudit({
      organizationId: auth.organizationId,
      userId: auth.userId,
      action: 'ai_authority.seed',
      resource: `organization:${auth.organizationId}`,
      details:
        'Initialised the AI Authority taxonomy (cities, services, markets, engines, templates).',
      metadata: { result: data },
    })

    return NextResponse.json({
      success: true,
      result: data,
      note:
        'Taxonomy and monitoring configuration only. No projects, reviews, citations, or AI results ' +
        'were created or fabricated.',
    })
  } catch (error) {
    return authorityErrorResponse(error, 'seed')
  }
}