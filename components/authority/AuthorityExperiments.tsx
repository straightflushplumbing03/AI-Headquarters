'use client'

import { Container } from '@/components/Container'
import { authorityApi } from '@/lib/authority/api-client'
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  Section,
} from '@/components/authority/ui'
import { formatDateTime, formatRelative, useAuthority } from '@/components/authority/use-authority'

/**
 * Experiment view.
 *
 * Reports what was OBSERVED after a change, never that the change caused it.
 * "Inconclusive" is presented as a normal, informative outcome rather than a
 * failure, because most single-site changes do not move a measurable metric.
 */
export function AuthorityExperiments() {
  const { data, loading, error, reload } = useAuthority(authorityApi.experiments)

  if (loading) return <LoadingState label="Loading experiments" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <EmptyState title="No experiments" detail="No experiments have been created." />

  const running = data.experiments.filter((e) => e.status === 'running')
  const concluded = data.experiments.filter((e) => e.status !== 'running')

  return (
    <Container className="py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Experiments</h1>
        <p className="text-slate-400 mt-1">
          Controlled changes with a recorded baseline and an honest result.
        </p>
      </header>

      <p className="text-xs text-slate-400 leading-relaxed border-l-2 border-sky-900 pl-3">
        {data.interpretation ??
          'A result reports what was observed after a change, never that the change caused it. ' +
            'Inconclusive is a valid and common outcome and is reported honestly.'}
      </p>

      <Section title="Running" subtitle="Changes currently being monitored.">
        {running.length === 0 ? (
          <EmptyState
            title="No experiments running"
            detail="Create an experiment before making a change you intend to measure, so the baseline is recorded honestly."
          />
        ) : (
          <ul className="space-y-4">
            {running.map((experiment) => (
              <li key={experiment.id} className="border border-slate-800 rounded-lg p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-medium">{experiment.name}</span>
                      <Badge tone="info">running</Badge>
                    </div>
                    <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                      {experiment.hypothesis}
                    </p>
                  </div>
                </div>
                <div className="text-xs text-slate-500 mt-2">
                  Metric: {experiment.metric} · started {formatRelative(experiment.started_at)}
                </div>
                {Object.keys(experiment.baseline ?? {}).length > 0 && (
                  <pre className="text-xs text-slate-500 mt-2 bg-slate-950 rounded p-2 overflow-x-auto">
                    {JSON.stringify(experiment.baseline, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Concluded"
        subtitle="Results as observed. Confidence is reported where it was computed; a low-confidence result is labelled as such rather than rounded up."
      >
        {concluded.length === 0 ? (
          <EmptyState title="No concluded experiments" detail="Results appear once an experiment is evaluated." />
        ) : (
          <ul className="space-y-4">
            {concluded.map((experiment) => {
              const latest = experiment.results?.[0]
              return (
                <li key={experiment.id} className="border border-slate-800 rounded-lg p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-medium">{experiment.name}</span>
                        <Badge tone="neutral">{experiment.status}</Badge>
                        {latest?.outcome && (
                          <Badge
                            tone={
                              latest.outcome === 'improved'
                                ? 'green'
                                : latest.outcome === 'declined'
                                  ? 'red'
                                  : 'neutral'
                            }
                          >
                            {latest.outcome}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                        {experiment.hypothesis}
                      </p>
                    </div>
                  </div>

                  <div className="text-xs text-slate-500 mt-2">
                    Metric: {experiment.metric} · {formatDateTime(experiment.started_at)} →{' '}
                    {formatDateTime(experiment.ended_at)}
                  </div>

                  {latest?.summary && (
                    <p className="text-sm text-slate-300 mt-2 leading-relaxed">{latest.summary}</p>
                  )}

                  {latest?.confidence !== null && latest?.confidence !== undefined && (
                    <p className="text-xs text-slate-500 mt-1">
                      Confidence: {latest.confidence}
                      {latest.confidence < 0.8
                        ? ' — below the threshold for a confident conclusion, so this result is reported as suggestive only.'
                        : ''}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <p className="text-xs text-slate-600 leading-relaxed">
        Experiments are evaluated over the metrics they were registered against. A single
        observation window rarely isolates one cause in a live search environment, so results
        describe correlation and are labelled accordingly.
      </p>
    </Container>
  )
}