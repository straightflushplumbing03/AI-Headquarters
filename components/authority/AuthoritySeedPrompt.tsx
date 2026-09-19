'use client'

import { useState } from 'react'
import { Card } from '@/components/Card'
import { authorityApi } from '@/lib/authority/api-client'

/**
 * First-run initialisation panel.
 *
 * Shown only when the taxonomy is empty. Seeding is an explicit action with a
 * stated scope, because a reader should know exactly what is and is not being
 * created -- in particular that no business evidence is invented to fill the
 * dashboard.
 */
export function AuthoritySeedPrompt({
  organizationId,
  onSeeded,
}: {
  organizationId: string
  onSeeded: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const seed = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await authorityApi.seed(organizationId)
      setResult(
        `Initialised ${response.result.cities} cities, ${response.result.services} services, ` +
          `${response.result.markets} markets, ${response.result.engines} engine registrations, and ` +
          `${response.result.templates} query templates.`
      )
      await onSeeded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Initialisation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-white">Initialise the authority engine</h2>
      <p className="text-sm text-slate-400 mt-1 leading-relaxed">
        This organization has no authority taxonomy yet. Initialisation creates the monitoring
        configuration only:
      </p>
      <ul className="text-sm text-slate-400 mt-3 space-y-1 list-disc list-inside">
        <li>5 priority cities and 4 priority services</li>
        <li>The 20 city × service authority markets</li>
        <li>AI engine registrations with their honest configured / unconfigured state</li>
        <li>Query templates across geographic, service, buyer, problem, comparison, emergency, and cost intent</li>
        <li>Budget ceilings and unconfigured integration records</li>
      </ul>
      <p className="text-sm text-slate-500 mt-3 leading-relaxed">
        It does not create projects, reviews, citations, or AI responses. Those must come from real
        business data and real collected answers. The action is idempotent and requires an owner or
        admin role.
      </p>

      {error && (
        <p className="text-sm text-rose-400 mt-4 border border-rose-900 bg-rose-950/40 rounded-lg px-4 py-2.5">
          {error}
        </p>
      )}
      {result && (
        <p className="text-sm text-emerald-300 mt-4 border border-emerald-900 bg-emerald-950/40 rounded-lg px-4 py-2.5">
          {result}
        </p>
      )}

      <button
        onClick={seed}
        disabled={busy}
        className="mt-4 text-sm font-semibold px-4 py-2.5 rounded-lg bg-gradient-to-r from-primary-600 to-primary-700 hover:from-primary-700 hover:to-primary-800 text-white disabled:opacity-50"
      >
        {busy ? 'Initialising…' : 'Initialise authority engine'}
      </button>
    </Card>
  )
}