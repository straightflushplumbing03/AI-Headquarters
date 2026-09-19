/**
 * AI Authority Engine -- API authentication and authorization helpers.
 *
 * Mirrors the posture used by /api/jobs/enqueue and /api/ai/execute:
 *
 *   - identity comes ONLY from the session cookie
 *   - membership in the target organization is verified SERVER-SIDE
 *   - the returned client is the user-scoped client, so RLS applies again on
 *     every query as a second, independent line of defence
 *
 * Two roles are distinguished:
 *   - "member"   -- may read everything for the org
 *   - "approver" -- may approve/reject and enable cost-bearing monitoring
 *
 * A membership check alone is not sufficient for approval actions: any invited
 * member should not be able to authorize customer-facing publication. If the
 * membership row does not carry a recognised role, the caller is treated as a
 * member, which is the safer default.
 */

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

export type AuthorityRole = 'member' | 'approver'

export interface AuthorityAuthContext {
  userId: string
  organizationId: string
  role: AuthorityRole
  supabase: SupabaseClient
}

export interface AuthorityAuthFailure {
  response: NextResponse
}

export function isAuthFailure(
  value: AuthorityAuthContext | AuthorityAuthFailure
): value is AuthorityAuthFailure {
  return 'response' in value
}

const APPROVER_ROLES = new Set(['owner', 'admin', 'approver'])

/**
 * Authenticate a request and resolve the org + role.
 *
 * `requestedOrganizationId` is accepted as a hint but NEVER trusted: it is
 * checked against the caller's actual memberships, and a mismatch is a 403.
 */
export async function authenticateAuthorityRequest(
  requestedOrganizationId: string | null | undefined
): Promise<AuthorityAuthContext | AuthorityAuthFailure> {
  let supabase: SupabaseClient
  try {
    supabase = (await createClient()) as unknown as SupabaseClient
  } catch (error) {
    console.error('[authority api] supabase client creation failed', error)
    return { response: NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 }) }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  if (!requestedOrganizationId || typeof requestedOrganizationId !== 'string') {
    return { response: NextResponse.json({ error: 'organizationId is required' }, { status: 400 }) }
  }

  const { data: member } = await supabase
    .from('organization_members')
    .select('id, role')
    .eq('user_id', user.id)
    .eq('organization_id', requestedOrganizationId)
    .maybeSingle()

  if (!member) {
    // Deliberately the same message as a bad org id: do not confirm existence.
    return { response: NextResponse.json({ error: 'Organization access denied' }, { status: 403 }) }
  }

  const rawRole = String((member as { role?: string }).role ?? '').toLowerCase()
  const role: AuthorityRole = APPROVER_ROLES.has(rawRole) ? 'approver' : 'member'

  return {
    userId: user.id,
    organizationId: requestedOrganizationId,
    role,
    supabase,
  }
}

/** Reject the request unless the caller may authorize customer-facing actions. */
export function requireApprover(
  context: AuthorityAuthContext
): NextResponse | null {
  if (context.role === 'approver') return null
  return NextResponse.json(
    {
      error: 'Approval requires an owner or admin role in this organization.',
      requiredRole: 'approver',
    },
    { status: 403 }
  )
}

/** Read the org id from the query string or JSON body. */
export function organizationIdFromRequest(
  request: Request,
  body?: Record<string, unknown> | null
): string | null {
  const fromBody = body?.organizationId
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody

  try {
    const url = new URL(request.url)
    const fromQuery = url.searchParams.get('organizationId')
    if (fromQuery) return fromQuery
  } catch {
    // Fall through: a malformed URL is handled by the caller as a 400.
  }
  return null
}

/** Consistent error mapping so internal messages never leak to the client. */
export function authorityErrorResponse(error: unknown, operation: string): NextResponse {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[authority api] ${operation} failed: ${message}`)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}