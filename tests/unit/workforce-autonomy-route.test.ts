/**
 * /api/workforce/autonomy: fails closed and forwards only validated input.
 * Authorization itself (owner/admin only, agents never) is tested in
 * tests/sql/workforce_delegation_test.sql.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { POST } from '@/app/api/workforce/autonomy/route'
import type { NextRequest } from 'next/server'

const AGENT = '22222222-2222-4222-8222-222222222222'
const ORG = '11111111-1111-4111-8111-111111111111'

function client(user: { id: string } | null, reply: { data: any; error: any } = { data: { ok: true }, error: null }) {
  const c = { auth: { getUser: vi.fn(async () => ({ data: { user } })) }, rpc: vi.fn(async () => reply) }
  vi.mocked(createClient).mockResolvedValue(c as any)
  return c
}
const req = (b: unknown) => ({ json: async () => b }) as unknown as NextRequest

beforeEach(() => vi.clearAllMocks())

describe('POST /api/workforce/autonomy', () => {
  it('401 without a session', async () => {
    const c = client(null)
    expect((await POST(req({ action: 'revoke_delegation', delegationId: AGENT }))).status).toBe(401)
    expect(c.rpc).not.toHaveBeenCalled()
  })

  it('refuses high-risk delegation before reaching the database', async () => {
    const c = client({ id: 'u' })
    const res = await POST(req({ action: 'grant_delegation', agentId: AGENT, tool: 'website.edit', maxRisk: 'high', maxCostUsd: 10 }))
    expect(res.status).toBe(400)
    expect(c.rpc).not.toHaveBeenCalled()
  })

  it('rejects unknown actions and categories', async () => {
    client({ id: 'u' })
    expect((await POST(req({ action: 'grant_self' }))).status).toBe(400)
    expect((await POST(req({ action: 'set_policy', organizationId: ORG, tool: 't', riskFloor: 'low', ownerOnly: false, category: 'anything' }))).status).toBe(400)
  })

  it('grants a delegation through the enforced function', async () => {
    const c = client({ id: 'u' }, { data: { ok: true, delegation_id: 'd1' }, error: null })
    const res = await POST(req({ action: 'grant_delegation', agentId: AGENT, tool: 'website.edit', resource: 'site:main', maxRisk: 'low', maxCostUsd: 50 }))
    expect(res.status).toBe(200)
    expect(c.rpc).toHaveBeenCalledWith('workforce_grant_approval_delegation', {
      p_delegate_agent_id: AGENT, p_tool: 'website.edit', p_resource: 'site:main',
      p_max_risk: 'low', p_max_cost_usd: 50, p_expires_at: null,
    })
  })

  it('maps a non-owner refusal to 403 and a sensitive delegable policy to 400', async () => {
    client({ id: 'u' }, { data: null, error: { message: 'WORKFORCE_FORBIDDEN: only an owner or admin can change autonomy settings' } })
    expect((await POST(req({ action: 'revoke_delegation', delegationId: AGENT }))).status).toBe(403)
    client({ id: 'u' }, { data: null, error: { message: 'new row for relation "workforce_action_policies" violates check constraint "workforce_action_policies_sensitive_owner_only"' } })
    expect((await POST(req({ action: 'set_policy', organizationId: ORG, tool: 'ads.budget', riskFloor: 'low', ownerOnly: false, category: 'spending' }))).status).toBe(400)
  })
})
