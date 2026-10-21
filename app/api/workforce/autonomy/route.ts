/**
 * Owner configuration of agent autonomy.
 *
 * POST /api/workforce/autonomy
 * Body (one of):
 *   { action: 'set_policy', organizationId, tool, resource?, riskFloor, ownerOnly, category? }
 *   { action: 'grant_delegation', agentId, tool, resource?, maxRisk: 'low'|'medium', maxCostUsd, expiresAt? }
 *   { action: 'revoke_delegation', delegationId }
 *   { action: 'grant_permission', agentId, tool, resource?, requiresApproval, expiresAt? }
 *   { action: 'revoke_permission', permissionId }
 *
 * Runs under the caller's own session; the database allows only owners/admins
 * of the organization and records every change as an event. Agents (service
 * role) can never reach these functions.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  setActionPolicy, grantApprovalDelegation, revokeApprovalDelegation,
  grantPermission, revokePermission, WorkforceError,
  type RiskLevel, type PolicyCategory,
} from '@/lib/workforce/service'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RISKS: RiskLevel[] = ['low', 'medium', 'high', 'critical']
const CATEGORIES: PolicyCategory[] = [
  'general', 'website', 'seo', 'content', 'advertising', 'spending', 'legal',
  'customer_data', 'security', 'production', 'irreversible',
]
const str = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const optStr = (v: unknown) => v === undefined || str(v)
const bad = (error: string) => NextResponse.json({ error }, { status: 400 })

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let b: Record<string, any>
  try {
    b = await request.json()
  } catch {
    return bad('Body must be JSON')
  }

  try {
    switch (b.action) {
      case 'set_policy': {
        if (!UUID.test(String(b.organizationId)) || !str(b.tool) || !optStr(b.resource)) return bad('organizationId and tool are required')
        if (!RISKS.includes(b.riskFloor) || typeof b.ownerOnly !== 'boolean') return bad('riskFloor and ownerOnly are required')
        if (b.category !== undefined && !CATEGORIES.includes(b.category)) return bad('unknown category')
        return NextResponse.json(await setActionPolicy(supabase as any, {
          organizationId: b.organizationId, tool: b.tool, resource: b.resource,
          riskFloor: b.riskFloor, ownerOnly: b.ownerOnly, category: b.category,
        }))
      }
      case 'grant_delegation': {
        if (!UUID.test(String(b.agentId)) || !str(b.tool) || !optStr(b.resource)) return bad('agentId and tool are required')
        if (b.maxRisk !== 'low' && b.maxRisk !== 'medium') return bad("maxRisk must be 'low' or 'medium'")
        if (typeof b.maxCostUsd !== 'number' || !(b.maxCostUsd >= 0)) return bad('maxCostUsd must be a non-negative number')
        if (b.expiresAt !== undefined && Number.isNaN(Date.parse(b.expiresAt))) return bad('expiresAt must be a date')
        return NextResponse.json(await grantApprovalDelegation(supabase as any, {
          agentId: b.agentId, tool: b.tool, resource: b.resource,
          maxRisk: b.maxRisk, maxCostUsd: b.maxCostUsd, expiresAt: b.expiresAt,
        }))
      }
      case 'revoke_delegation': {
        if (!UUID.test(String(b.delegationId))) return bad('delegationId is required')
        return NextResponse.json(await revokeApprovalDelegation(supabase as any, b.delegationId))
      }
      case 'grant_permission': {
        if (!UUID.test(String(b.agentId)) || !str(b.tool) || !optStr(b.resource)) return bad('agentId and tool are required')
        if (typeof b.requiresApproval !== 'boolean') return bad('requiresApproval must be true or false')
        if (b.expiresAt !== undefined && Number.isNaN(Date.parse(b.expiresAt))) return bad('expiresAt must be a date')
        return NextResponse.json(await grantPermission(
          supabase as any, b.agentId, b.tool, b.resource ?? '*', b.requiresApproval, b.expiresAt))
      }
      case 'revoke_permission': {
        if (!UUID.test(String(b.permissionId))) return bad('permissionId is required')
        return NextResponse.json(await revokePermission(supabase as any, b.permissionId))
      }
      default:
        return bad("unknown action")
    }
  } catch (e) {
    if (e instanceof WorkforceError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    return NextResponse.json({ error: 'Workforce request failed' }, { status: 500 })
  }
}
