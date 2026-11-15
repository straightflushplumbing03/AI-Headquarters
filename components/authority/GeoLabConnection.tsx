'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Container } from '@/components/Container'

import { authorityApi } from '@/lib/authority/api-client'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricDisclosure,
  Section,
  Stat,
} from '@/components/authority/ui'
import { formatDateTime, formatNumber, formatRelative, useAuthority } from '@/components/authority/use-authority'

/**
 * GEO Lab connection status (spec Phase 4, admin screen).
 *
 * Shows, from stored data plus one live probe, whether Headquarters is
 * connected to the GEO Intelligence Lab: the last sync, what came in, and what
 * is stale. Nothing here is inferred. An unconfigured integration says so and
 * names the environment variables that are missing, rather than showing an
 * empty dashboard that looks like a working one with no data.
 */
export function GeoLabConnection() {
  const params = useParams()
  const organizationId = params?.id as string | undefined

  const { data, loading, error, reload } = useAuthority(authorityApi.geolabStatus)
  const { data: jobs, reload: reloadJobs } = useAuthority(authorityApi.geolabJobs)
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function runSync() {
    if (!organizationId) return
    setSyncing(true)
    setSyncNote(null)
    setActionError(null)
    try {
      const result = await authorityApi.geolabSync(organizationId)
      setSyncNote(
        result.status === 'succeeded'
          ? `Sync succeeded: ${formatNumber(result.imported)} records imported in ${formatNumber(result.durationMs)}ms.`
          : result.status === 'partial'
            ? `Sync partly succeeded: ${formatNumber(result.imported)} imported, ${formatNumber(result.skipped)} skipped. ${result.errorMessage ?? ''}`
            : `Sync failed: ${result.errorMessage ?? result.errorReason ?? 'unknown error'}`
      )
      reload()
      reloadJobs()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    } finally {
      setSyncing(false)
    }
  }

  if (loading) return <LoadingState label="Checking GEO Lab connection" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <EmptyState title="No status available" detail="The status endpoint returned nothing." />

  const stateLabel =
    data.state === 'connected'
      ? 'Connected'
      : data.state === 'degraded'
        ? 'Connected, data stale'
        : data.state === 'error'
          ? 'Error'
          : 'Not configured'

  return (
    <Container className="space-y-6 py-8">
      <Section title="GEO Intelligence Lab" subtitle={data.message}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Connection" value={stateLabel} />
          <Stat label="Latency" value={data.latencyMs === null ? '—' : `${formatNumber(data.latencyMs)} ms`} />
          <Stat label="Last sync" value={data.lastSyncAt ? formatRelative(data.lastSyncAt) : 'Never'} />
          <Stat
            label="Data freshness"
            value={
              data.dataFreshnessMinutes === null ? 'No successful sync' : `${formatNumber(data.dataFreshnessMinutes)} min`
            }
          />
        </div>

        {!data.configured && (
          <div className="mt-4 rounded-md border border-amber-700/60 bg-amber-950/40 p-4 text-sm text-amber-200">
            <p className="font-medium">This integration is not configured on the server.</p>
            <p className="mt-1 leading-relaxed">
              Set{' '}
              {data.missingEnvVars.map((v) => (
                <code key={v} className="mx-0.5 rounded bg-amber-900/60 px-1 font-mono text-xs">
                  {v}
                </code>
              ))}{' '}
              and redeploy Headquarters. No data is shown until it is set, because an empty dashboard would look like a
              working connection with nothing in it.
            </p>
          </div>
        )}

        {data.latestRun && (
          <p className="mt-4 text-sm text-slate-400">
            Latest run: <span className="font-medium text-slate-200">{data.latestRun.status}</span> at{' '}
            {formatDateTime(data.latestRun.startedAt)} — {formatNumber(data.latestRun.recordsImported)} imported of{' '}
            {formatNumber(data.latestRun.recordsFetched)} fetched.
            {data.latestRun.errorMessage ? ` Error: ${data.latestRun.errorMessage}` : ''}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={runSync}
            disabled={syncing || !data.configured}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button
            type="button"
            onClick={reload}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-500"
          >
            Refresh status
          </button>
        </div>

        {syncNote && <p className="mt-3 text-sm text-slate-300">{syncNote}</p>}
        {actionError && <p className="mt-3 text-sm text-rose-400">{actionError}</p>}
      </Section>

      <Section title="Imported records" subtitle="What Headquarters has stored from the Lab.">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Visibility observations" value={formatNumber(data.records.visibility)} />
          <Stat label="Daily history" value={formatNumber(data.records.visibilityHistory)} />
          <Stat label="Competitors" value={formatNumber(data.records.competitors)} />
          <Stat label="Citation sources" value={formatNumber(data.records.citations)} />
          <Stat label="Cities" value={formatNumber(data.records.geo)} />
          <Stat label="Opportunities" value={formatNumber(data.records.opportunities)} />
          <Stat label="Jobs submitted" value={formatNumber(data.records.jobs)} />
        </div>
      </Section>

      <Section
        title="Jobs submitted to the Lab"
        subtitle="Read-only jobs run on the Lab. Any job that could touch production waits for an owner to approve it there."
      >
        {!jobs || jobs.jobs.length === 0 ? (
          <EmptyState title="No jobs submitted" detail="Jobs submitted from Headquarters will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-slate-500">
                  <th className="py-2 pr-4 font-medium">Job</th>
                  <th className="py-2 pr-4 font-medium">Kind</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Approval</th>
                  <th className="py-2 font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {jobs.jobs.map((job) => (
                  <tr key={job.lab_job_id} className="border-b border-slate-800/60 text-slate-300">
                    <td className="py-2 pr-4 font-mono text-xs">{job.lab_job_id}</td>
                    <td className="py-2 pr-4">{job.kind}</td>
                    <td className="py-2 pr-4">{job.status}</td>
                    <td className="py-2 pr-4">{job.requires_approval ? 'Owner approval required' : 'Automatic'}</td>
                    <td className="py-2">{formatDateTime(job.submitted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <MetricDisclosure
        text={
          'Connection status comes from one live request to the Lab plus stored sync history. ' +
          'Record counts are exact counts of rows imported into Headquarters. ' +
          'No figure on this screen is estimated.'
        }
      />
    </Container>
  )
}
