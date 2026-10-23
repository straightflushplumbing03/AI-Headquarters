'use client'

/**
 * Owner controls for agent autonomy: per-agent permissions, action policies
 * and delegated approval authority.
 *
 * Reads go through the browser client (row-level security limits them to the
 * viewer's organization). Every change goes through POST
 * /api/workforce/autonomy, where the database allows only owners/admins and
 * records the change as an event. Showing these controls to a non-admin
 * grants nothing: the server refuses and the error is shown.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'

type Agent = { id: string; name: string; role: string }
type Permission = { id: string; agent_id: string; tool: string; resource: string; requires_approval: boolean; expires_at: string | null }
type Policy = { id: string; tool: string; resource: string; risk_floor: string; owner_only: boolean; category: string }
type Delegation = { id: string; delegate_agent_id: string; tool: string; resource: string; max_risk: string; max_cost_usd: number; expires_at: string | null }

const CATEGORIES = ['general', 'website', 'seo', 'content', 'advertising', 'spending', 'legal', 'customer_data', 'security', 'production', 'irreversible']
const SENSITIVE = new Set(['spending', 'legal', 'customer_data', 'security', 'production', 'irreversible'])
const selectClass = 'w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100'

export function AgentAutonomySettings() {
  const params = useParams()
  const organizationId = params.id as string
  const supabase = createClient()

  const [agents, setAgents] = useState<Agent[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [policies, setPolicies] = useState<Policy[]>([])
  const [delegations, setDelegations] = useState<Delegation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [perm, setPerm] = useState({ agentId: '', tool: '', resource: '*', requiresApproval: true })
  const [pol, setPol] = useState({ tool: '', resource: '*', riskFloor: 'medium', category: 'general', ownerOnly: true })
  const [del, setDel] = useState({ agentId: '', tool: '', resource: '*', maxRisk: 'low', maxCostUsd: '0' })

  const load = useCallback(async () => {
    const [a, p, po, d] = await Promise.all([
      supabase.from('agents').select('id, name, role').eq('organization_id', organizationId).eq('active', true).order('name'),
      supabase.from('workforce_agent_permissions').select('id, agent_id, tool, resource, requires_approval, expires_at')
        .eq('organization_id', organizationId).is('revoked_at', null).order('tool'),
      supabase.from('workforce_action_policies').select('id, tool, resource, risk_floor, owner_only, category')
        .eq('organization_id', organizationId).order('tool'),
      supabase.from('workforce_approval_delegations').select('id, delegate_agent_id, tool, resource, max_risk, max_cost_usd, expires_at')
        .eq('organization_id', organizationId).is('revoked_at', null).order('tool'),
    ])
    const failed = [a, p, po, d].find((r) => r.error)
    if (failed?.error) setError(`Could not load autonomy settings: ${failed.error.message}`)
    setAgents((a.data as Agent[]) ?? [])
    setPermissions((p.data as Permission[]) ?? [])
    setPolicies((po.data as Policy[]) ?? [])
    setDelegations((d.data as Delegation[]) ?? [])
  }, [organizationId, supabase])

  useEffect(() => {
    load()
  }, [load])

  const send = async (body: Record<string, unknown>, done: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/workforce/autonomy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || 'Request failed')
        return false
      }
      setNotice(done)
      await load()
      return true
    } finally {
      setBusy(false)
    }
  }

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? 'Unknown agent'

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold">Agent autonomy</h2>
        <p className="text-slate-400 mt-1 text-sm">
          Agents can only use tools granted here, and every check is enforced on the server. Changes are owner or
          admin only and are recorded in the activity log.
        </p>
      </div>

      {error && <Card className="border border-red-700 text-red-300 text-sm">{error}</Card>}
      {notice && <Card className="border border-emerald-700 text-emerald-300 text-sm">{notice}</Card>}

      {/* ---------------------------------------------------------- permissions */}
      <Card className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Permissions</h3>
          <p className="text-slate-400 text-sm">What each agent may do. With approval required, every use waits for a decision.</p>
          <p className="text-slate-400 text-sm mt-1">
            Granting <code>site.audit</code> on a site (for example <code>https://straightflushplumbingoc.com</code>) or{' '}
            <code>report.write</code> on a report name, without approval, gives that agent one read-only task per week.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <select className={selectClass} value={perm.agentId} onChange={(e) => setPerm({ ...perm, agentId: e.target.value })} aria-label="Agent">
            <option value="">Choose agent</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <Input placeholder="Tool, e.g. website.edit" value={perm.tool} onChange={(e) => setPerm({ ...perm, tool: e.target.value })} aria-label="Tool" />
          <Input placeholder="Resource, e.g. site:main" value={perm.resource} onChange={(e) => setPerm({ ...perm, resource: e.target.value })} aria-label="Resource" />
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={perm.requiresApproval} onChange={(e) => setPerm({ ...perm, requiresApproval: e.target.checked })} />
            Requires approval
          </label>
        </div>
        <Button size="sm" disabled={busy || !perm.agentId || !perm.tool.trim()}
          onClick={async () => {
            if (await send({ action: 'grant_permission', ...perm, resource: perm.resource.trim() || '*' }, 'Permission granted.')) {
              setPerm({ ...perm, tool: '', resource: '*' })
            }
          }}>
          Grant permission
        </Button>
        <List empty="No permissions granted. Agents cannot act until you grant one.">
          {permissions.map((p) => (
            <Row key={p.id} onRemove={() => send({ action: 'revoke_permission', permissionId: p.id }, 'Permission revoked.')} busy={busy} removeLabel="Revoke">
              <span className="font-medium">{agentName(p.agent_id)}</span>: {p.tool} on {p.resource}
              {p.requires_approval ? <Tag>approval required</Tag> : <Tag>no approval</Tag>}
            </Row>
          ))}
        </List>
      </Card>

      {/* ---------------------------------------------------------- policies */}
      <Card className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Action policies</h3>
          <p className="text-slate-400 text-sm">
            Sets the minimum risk for an action and whether agents may ever approve it. Actions without a policy are
            owner-only. Spending, legal, customer data, security, production and irreversible actions are always owner-only.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <Input placeholder="Tool" value={pol.tool} onChange={(e) => setPol({ ...pol, tool: e.target.value })} aria-label="Policy tool" />
          <Input placeholder="Resource" value={pol.resource} onChange={(e) => setPol({ ...pol, resource: e.target.value })} aria-label="Policy resource" />
          <select className={selectClass} value={pol.riskFloor} onChange={(e) => setPol({ ...pol, riskFloor: e.target.value })} aria-label="Minimum risk">
            {['low', 'medium', 'high', 'critical'].map((r) => <option key={r} value={r}>Min risk: {r}</option>)}
          </select>
          <select className={selectClass} value={pol.category}
            onChange={(e) => setPol({ ...pol, category: e.target.value, ownerOnly: SENSITIVE.has(e.target.value) ? true : pol.ownerOnly })}
            aria-label="Category">
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={pol.ownerOnly} disabled={SENSITIVE.has(pol.category)}
              onChange={(e) => setPol({ ...pol, ownerOnly: e.target.checked })} />
            Owner only
          </label>
        </div>
        <Button size="sm" disabled={busy || !pol.tool.trim()}
          onClick={() => send({ action: 'set_policy', organizationId, ...pol, resource: pol.resource.trim() || '*' }, 'Policy saved.')}>
          Save policy
        </Button>
        <List empty="No policies. Every approval goes to you.">
          {policies.map((p) => (
            <Row key={p.id}>
              {p.tool} on {p.resource}: minimum risk {p.risk_floor}, {p.category.replace('_', ' ')}
              {p.owner_only ? <Tag>owner only</Tag> : <Tag>agents may approve</Tag>}
            </Row>
          ))}
        </List>
      </Card>

      {/* ---------------------------------------------------------- delegations */}
      <Card className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Delegated approval</h3>
          <p className="text-slate-400 text-sm">
            Lets an agent approve other agents&apos; requests for one action, up to low or medium risk and a cost limit.
            It can never approve its own requests or actions it has no permission for. Anything outside these limits comes to you.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <select className={selectClass} value={del.agentId} onChange={(e) => setDel({ ...del, agentId: e.target.value })} aria-label="Reviewer agent">
            <option value="">Choose reviewer</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <Input placeholder="Tool" value={del.tool} onChange={(e) => setDel({ ...del, tool: e.target.value })} aria-label="Delegation tool" />
          <Input placeholder="Resource" value={del.resource} onChange={(e) => setDel({ ...del, resource: e.target.value })} aria-label="Delegation resource" />
          <select className={selectClass} value={del.maxRisk} onChange={(e) => setDel({ ...del, maxRisk: e.target.value })} aria-label="Maximum risk">
            <option value="low">Up to low risk</option>
            <option value="medium">Up to medium risk</option>
          </select>
          <Input type="number" min="0" step="1" placeholder="Max cost (USD)" value={del.maxCostUsd}
            onChange={(e) => setDel({ ...del, maxCostUsd: e.target.value })} aria-label="Maximum cost in USD" />
        </div>
        <Button size="sm" disabled={busy || !del.agentId || !del.tool.trim() || !(Number(del.maxCostUsd) >= 0)}
          onClick={() => send({
            action: 'grant_delegation', agentId: del.agentId, tool: del.tool, resource: del.resource.trim() || '*',
            maxRisk: del.maxRisk, maxCostUsd: Number(del.maxCostUsd),
          }, 'Approval authority granted.')}>
          Grant approval authority
        </Button>
        <List empty="No delegations. Only you can approve.">
          {delegations.map((d) => (
            <Row key={d.id} onRemove={() => send({ action: 'revoke_delegation', delegationId: d.id }, 'Approval authority revoked.')} busy={busy} removeLabel="Revoke">
              <span className="font-medium">{agentName(d.delegate_agent_id)}</span> may approve {d.tool} on {d.resource}
              <Tag>up to {d.max_risk} risk</Tag><Tag>${Number(d.max_cost_usd).toFixed(0)} max</Tag>
            </Row>
          ))}
        </List>
      </Card>
    </div>
  )
}

function List({ children, empty }: { children: React.ReactNode[]; empty: string }) {
  if (children.length === 0) return <p className="text-sm text-slate-500">{empty}</p>
  return <ul className="divide-y divide-slate-800 border-t border-slate-800">{children}</ul>
}

function Row({ children, onRemove, busy, removeLabel }: {
  children: React.ReactNode; onRemove?: () => void; busy?: boolean; removeLabel?: string
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-3 text-sm text-slate-300">
      <span className="flex flex-wrap items-center gap-2">{children}</span>
      {onRemove && <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>{removeLabel}</Button>}
    </li>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{children}</span>
}
