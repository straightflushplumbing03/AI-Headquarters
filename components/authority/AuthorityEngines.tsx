'use client'

import { Container } from '@/components/Container'
import { authorityApi } from '@/lib/authority/api-client'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricDisclosure,
  Meter,
  Section,
} from '@/components/authority/ui'
import { formatNumber, formatPercent, formatRelative, useAuthority } from '@/components/authority/use-authority'

/**
 * Engine view.
 *
 * The purpose of this screen is to be unambiguous about which engines are
 * genuinely connected. An unconfigured engine shows why, and shows a skipped
 * run count rather than an empty result that could be misread as "no mentions
 * found".
 */
export function AuthorityEngines() {
  const { data, loading, error, reload } = useAuthority(authorityApi.engines)

  if (loading) return <LoadingState label="Loading engines" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <EmptyState title="No engines" detail="No AI engines are registered." />

  const configured = data.engines.filter((e) => e.capability === 'supported')

  return (
    <Container className="py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">AI Engines</h1>
        <p className="text-slate-400 mt-1">
          {configured.length} of {data.engines.length} engines are configured and can be queried in
          this environment.
        </p>
      </header>

      <MetricDisclosure text={data.metricDisclosure} />

      {data.engines.length === 0 ? (
        <EmptyState title="No engines registered" detail="Run the authority seed migration to register the engine catalogue." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data.engines.map((engine) => (
            <Section
              key={engine.key}
              title={engine.displayName}
              subtitle={`${engine.vendor} · ${engine.model ?? 'no model configured'}`}
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {engine.capability === 'supported' ? (
                    <span className="text-xs px-2 py-0.5 rounded border bg-emerald-950 text-emerald-300 border-emerald-800">
                      connected
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded border bg-amber-950 text-amber-300 border-amber-800">
                      awaiting credential
                    </span>
                  )}
                  <span className="text-xs text-slate-500">
                    last query {formatRelative(engine.lastQueryAt)}
                  </span>
                </div>

                {engine.capability !== 'supported' && engine.credentialEnvVar && (
                  <p className="text-xs text-slate-400 leading-relaxed border-l-2 border-amber-900 pl-3">
                    Set <code className="text-amber-300">{engine.credentialEnvVar}</code> to enable
                    this engine. Until then, queries routed here are recorded as skipped with the
                    reason, and no response is invented.
                  </p>
                )}

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Responses</div>
                    <div className="text-xl font-bold tabular-nums text-white">
                      {formatNumber(engine.stats.responsesCollected)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Mention rate</div>
                    <div className="text-xl font-bold tabular-nums text-white">
                      {formatPercent(engine.stats.mentionRate)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Citation rate</div>
                    <div className="text-xl font-bold tabular-nums text-white">
                      {formatPercent(engine.stats.citationRate)}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Meter
                    value={engine.stats.mentionRate}
                    label="Mention rate"
                    tone={engine.stats.mentionRate >= 50 ? 'emerald' : 'amber'}
                  />
                  <Meter
                    value={engine.stats.firstMentionRate}
                    label="First-mention rate"
                    tone={engine.stats.firstMentionRate >= 25 ? 'emerald' : 'amber'}
                  />
                  <Meter
                    value={engine.stats.citationRate}
                    label="Citation rate"
                    tone={engine.stats.citationRate >= 25 ? 'emerald' : 'amber'}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs text-slate-500">
                  <div>Runs attempted: {formatNumber(engine.stats.runsAttempted)}</div>
                  <div>Completed: {formatNumber(engine.stats.completed)}</div>
                  <div>Skipped: {formatNumber(engine.stats.skipped)}</div>
                  <div>Failed: {formatNumber(engine.stats.failed)}</div>
                  <div className="col-span-2">
                    Distinct source domains cited: {formatNumber(engine.stats.distinctSourceDomains)}
                  </div>
                </div>

                {engine.lastError && (
                  <p className="text-xs text-rose-400 leading-relaxed">
                    Last error: {engine.lastError}
                  </p>
                )}
              </div>
            </Section>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-600 leading-relaxed">
        Each engine is queried only through its official API or an explicitly authorized
        integration, subject to that provider&apos;s terms, rate limits, and authentication
        requirements. Automation of surfaces where it is prohibited is not attempted.
      </p>
    </Container>
  )
}