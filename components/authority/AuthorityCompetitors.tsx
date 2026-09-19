'use client'

import { Container } from '@/components/Container'
import { authorityApi } from '@/lib/authority/api-client'
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricDisclosure,
  Section,
} from '@/components/authority/ui'
import { formatNumber, formatRelative, useAuthority } from '@/components/authority/use-authority'

/**
 * Competitor view.
 *
 * Observation only. Share of voice is computed exclusively over answers this
 * system collected, so it measures our sample, not the market. The disclosure
 * says so, and no claim about a competitor is made beyond what was observed.
 */
export function AuthorityCompetitors() {
  const { data, loading, error, reload } = useAuthority(authorityApi.competitors)

  if (loading) return <LoadingState label="Loading competitors" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <EmptyState title="No competitors" detail="No competitors have been observed yet." />

  const ordered = [...data.competitors].sort(
    (a, b) => (b.current?.internalShareOfVoice ?? 0) - (a.current?.internalShareOfVoice ?? 0)
  )

  return (
    <Container className="py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Competitors</h1>
        <p className="text-slate-400 mt-1">
          {data.competitors.length} competitor{data.competitors.length === 1 ? '' : 's'} observed in
          collected answers.
        </p>
      </header>

      <MetricDisclosure text={data.metricDisclosure} />

      {ordered.length === 0 ? (
        <Section title="No competitors observed">
          <EmptyState
            title="Nothing to show yet"
            detail="Competitors are discovered from collected answers. Run AI query collection to populate this view."
          />
        </Section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {ordered.map((competitor) => (
            <Section
              key={competitor.id}
              title={competitor.name}
              subtitle={
                competitor.website
                  ? competitor.website.replace(/^https?:\/\//, '').replace(/\/$/, '')
                  : 'no website recorded'
              }
            >
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Mentions</div>
                    <div className="text-lg font-bold tabular-nums text-white">
                      {formatNumber(competitor.current?.mentionCount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Citations</div>
                    <div className="text-lg font-bold tabular-nums text-white">
                      {formatNumber(competitor.current?.citationCount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                      Share of voice
                    </div>
                    <div className="text-lg font-bold tabular-nums text-white">
                      {competitor.current?.internalShareOfVoice ?? '—'}
                    </div>
                  </div>
                </div>

                {competitor.mentionDelta !== null && (
                  <div className="text-xs">
                    <span className="text-slate-500">Change since previous snapshot: </span>
                    <span
                      className={
                        competitor.mentionDelta > 0
                          ? 'text-amber-400'
                          : competitor.mentionDelta < 0
                            ? 'text-emerald-400'
                            : 'text-slate-400'
                      }
                    >
                      {competitor.mentionDelta > 0 ? '+' : ''}
                      {competitor.mentionDelta} mentions
                    </span>
                  </div>
                )}

                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Cities</div>
                  <div className="flex flex-wrap gap-1">
                    {competitor.locations.length > 0 ? (
                      competitor.locations.map((city) => (
                        <Badge key={city} tone="neutral">
                          {city}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-slate-600">no city context recorded</span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Services</div>
                  <div className="flex flex-wrap gap-1">
                    {competitor.services.length > 0 ? (
                      competitor.services.map((service) => (
                        <Badge key={service} tone="info">
                          {service}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-slate-600">no service context recorded</span>
                    )}
                  </div>
                </div>

                <div className="text-xs text-slate-500">
                  First seen {formatRelative(competitor.firstSeenAt)} · last seen{' '}
                  {formatRelative(competitor.lastSeenAt)}
                  {competitor.discoverySource ? ` · discovered via ${competitor.discoverySource}` : ''}
                </div>

                {competitor.recentChanges.length > 0 && (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                      Recent changes
                    </div>
                    <ul className="space-y-1">
                      {competitor.recentChanges.slice(0, 3).map((change, index) => (
                        <li key={index} className="text-xs text-slate-400 leading-relaxed">
                          {String((change as Record<string, unknown>).detail ?? '')}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-600 leading-relaxed">
        This subsystem never attacks, impersonates, or publishes claims about a competitor. It
        observes publicly available presence and records it. A rise in a competitor&apos;s observed
        mentions is a signal to investigate, not proof of a trend.
      </p>
    </Container>
  )
}