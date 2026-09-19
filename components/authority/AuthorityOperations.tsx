'use client'

import { useState } from 'react'
import { Container } from '@/components/Container'
import { authorityApi, authorityQuery } from '@/lib/authority/api-client'
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricDisclosure,
  Section,
} from '@/components/authority/ui'
import { formatDateTime, formatNumber, formatRelative, useAuthority } from '@/components/authority/use-authority'

/**
 * Operations view.
 *
 * Collection health, cost control, and the manual triggers. Two things here
 * matter for trust:
 *
 *   - A skipped run means no data was collected AND no money was spent. It is
 *     shown as its own state, never folded into "failed" or "no mentions".
 *   - Manual triggers are approver-only and the button says what it will do
 *     before it does it.
 */

interface RunRow {
  id: string
  engine_id: string | null
  query_id: string | null
  status: string
  error_detail?: string | null
  skip_reason?: string | null
  created_at: string
  completed_at?: string | null
  cost_estimate?: number | null
}

export function AuthorityOperations() {
  const { organizationId, data, loading, error, reload } = useAuthority(async (id) =>
    Promise.all([
      fetch(`/api/ai-authority/query-runs?${authorityQuery(id, { limit: 100 })}`, {
        cache: 'no-store',
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? 'Failed to load runs')
        return r.json()
      }),
      authorityApi.settings(id),
    ]).then(([runs, settings]) => ({ runs, settings }))
  )

  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  if (loading) return <LoadingState label="Loading operations" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <EmptyState title="No operations data" detail="No collection data is available." />

  const runs = (data.runs.runs ?? []) as RunRow[]
  const totals = (data.runs.totals ?? {}) as Record<string, number>
  const { settings } = data

  const runCollection = async (mode: string) => {
    if (!organizationId) return
    setBusy(mode)
    setActionError(null)
    setNote(null)
    try {
      const response = await fetch('/api/ai-authority/query-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId, mode }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Failed to queue collection')
      setNote(payload?.note ?? 'Collection queued.')
      await reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to queue collection')
    } finally {
      setBusy(null)
    }
  }

  const runCrawl = async () => {
    if (!organizationId) return
    setBusy('crawl')
    setActionError(null)
    setNote(null)
    try {
      const response = await fetch('/api/ai-authority/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error ?? 'Failed to queue crawl')
      setNote(payload?.note ?? 'Crawl queued.')
      await reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to queue crawl')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Container className="py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Operations</h1>
        <p className="text-slate-400 mt-1">
          Collection health, cost control, and manual triggers for the authority pipeline.
        </p>
      </header>

      <p className="text-xs text-slate-400 leading-relaxed border-l-2 border-sky-900 pl-3">
        {data.runs.note}
      </p>

      {actionError && (
        <div className="text-sm text-rose-400 border border-rose-900 bg-rose-950/40 rounded-lg px-4 py-3">
          {actionError}
        </div>
      )}
      {note && (
        <div className="text-sm text-emerald-300 border border-emerald-900 bg-emerald-950/40 rounded-lg px-4 py-3">
          {note}
        </div>
      )}

      <Section
        title="Cost control"
        subtitle="Budgets are enforced before any provider call is made. When a limit is reached, queries are queued or skipped rather than silently overspending."
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Queries today</div>
            <div className="text-xl font-bold tabular-nums text-white">
              {formatNumber(settings.usage?.queriesToday)}
              <span className="text-sm font-normal text-slate-500">
                {' / '}
                {formatNumber(settings.budget?.daily_query_limit)}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Queries this month</div>
            <div className="text-xl font-bold tabular-nums text-white">
              {formatNumber(settings.usage?.queriesThisMonth)}
              <span className="text-sm font-normal text-slate-500">
                {' / '}
                {formatNumber(settings.budget?.monthly_query_limit)}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Cost this month</div>
            <div className="text-xl font-bold tabular-nums text-white">
              ${Number(settings.usage?.costThisMonth ?? 0).toFixed(2)}
              <span className="text-sm font-normal text-slate-500">
                {' / $'}
                {Number(settings.budget?.monthly_cost_ceiling ?? 0).toFixed(2)}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">State</div>
            <div className="text-xl font-bold">
              {settings.killSwitches?.organizationPaused ? (
                <span className="text-rose-400">paused</span>
              ) : (
                <span className="text-emerald-400">active</span>
              )}
            </div>
            {settings.killSwitches?.organizationPaused && settings.budget?.pause_reason && (
              <div className="text-xs text-slate-500 mt-0.5">{settings.budget.pause_reason}</div>
            )}
          </div>
        </div>

        {settings.killSwitches?.globalPausedNote && (
          <p className="text-xs text-slate-500 mt-4 leading-relaxed">
            {settings.killSwitches.globalPausedNote}
          </p>
        )}
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          {settings.credentialPolicy}
        </p>
      </Section>

      <Section
        title="Manual triggers"
        subtitle="Running collection consumes provider quota and budget. Triggers require an owner or admin role."
      >
        <div className="flex flex-wrap gap-2">
          {[
            { mode: 'full', label: 'Run full collection' },
            { mode: 'ai_responses', label: 'Collect AI responses' },
            { mode: 'competitors', label: 'Refresh competitors' },
            { mode: 'scoring', label: 'Recompute scores' },
          ].map((action) => (
            <button
              key={action.mode}
              onClick={() => runCollection(action.mode)}
              disabled={busy !== null}
              className="text-sm px-3 py-2 rounded border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy === action.mode ? 'Queueing…' : action.label}
            </button>
          ))}
          <button
            onClick={runCrawl}
            disabled={busy !== null}
            className="text-sm px-3 py-2 rounded border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy === 'crawl' ? 'Queueing…' : 'Crawl website'}
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-3 leading-relaxed">
          Triggers enqueue durable background jobs. They return immediately; results appear here and
          in the audit log as the worker processes them.
        </p>
      </Section>

      <Section
        title="Recent runs"
        subtitle="The last 100 query runs across all engines, with their outcome and reason."
      >
        <div className="flex flex-wrap gap-4 mb-4 text-sm">
          {Object.entries(totals).map(([status, count]) => (
            <span key={status} className="text-slate-400">
              <span className="text-slate-500">{status}: </span>
              <span className="tabular-nums text-slate-200">{count}</span>
            </span>
          ))}
          {Object.keys(totals).length === 0 && (
            <span className="text-slate-500">No runs recorded.</span>
          )}
        </div>

        {runs.length === 0 ? (
          <EmptyState
            title="No runs recorded"
            detail="Runs appear once collection is triggered or the daily schedule fires."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Reason / error</th>
                  <th className="py-2 text-right">Completed</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-slate-800/60">
                    <td className="py-2 pr-4 text-slate-300">{formatDateTime(run.created_at)}</td>
                    <td className="py-2 pr-4">
                      <Badge
                        tone={
                          run.status === 'completed'
                            ? 'green'
                            : run.status === 'failed'
                              ? 'red'
                              : run.status === 'skipped'
                                ? 'neutral'
                                : 'info'
                        }
                      >
                        {run.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-slate-500 text-xs leading-relaxed">
                      {run.error_detail ?? run.skip_reason ?? '—'}
                    </td>
                    <td className="py-2 text-right text-slate-500">
                      {formatRelative(run.completed_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <MetricDisclosure text="Skipped runs incur no cost and produce no data. They are recorded so the gap in coverage is visible rather than appearing as a market with zero visibility." />

      <Section
        title="Integrations"
        subtitle="External data sources. Each requires its own credential and authorized access."
      >
        <ul className="space-y-2">
          {settings.integrations.map((integration: Record<string, unknown>) => (
            <li
              key={String(integration.provider)}
              className="flex items-start justify-between border-b border-slate-800 pb-2 last:border-0"
            >
              <div>
                <div className="text-sm text-slate-200">{String(integration.displayName)}</div>
                <div className="text-xs text-slate-500">
                  {String(integration.status)} · last sync {formatRelative(String(integration.lastSyncAt ?? ''))}
                </div>
                {(integration.missingEnvVars as string[]).length > 0 && (
                  <div className="text-xs text-amber-400 mt-0.5">
                    Requires: {(integration.missingEnvVars as string[]).join(', ')}
                  </div>
                )}
                {integration.lastError ? (
                  <div className="text-xs text-rose-400 mt-0.5">
                    Last error: {String(integration.lastError)}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
          {settings.integrations.length === 0 && (
            <li className="text-sm text-slate-500">No integrations registered.</li>
          )}
        </ul>
      </Section>
    </Container>
  )
}