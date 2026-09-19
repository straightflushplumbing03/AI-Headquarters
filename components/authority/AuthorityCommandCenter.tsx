'use client'

import Link from 'next/link'
import { Container } from '@/components/Container'

import { authorityApi } from '@/lib/authority/api-client'
import { AuthoritySeedPrompt } from '@/components/authority/AuthoritySeedPrompt'
import {
  ApprovalBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricDisclosure,
  Section,
  SeverityBadge,
  Stat,
} from '@/components/authority/ui'
import {
  formatDate,
  formatNumber,
  formatPercent,
  formatRelative,
  useAuthority,
} from '@/components/authority/use-authority'

/**
 * AI Authority Command Center.
 *
 * Answers "how is Straight Flush performing in AI search right now?" in one
 * screen, and does so without overstating what the numbers are. Every figure on
 * this page is an internal measurement over answers this system collected; the
 * disclosure is rendered at the top, not buried.
 */
export function AuthorityCommandCenter() {
  const { organizationId, data, loading, error, reload } = useAuthority(authorityApi.overview)

  if (loading) return <LoadingState label="Loading authority overview" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data || !organizationId) return <EmptyState title="No data" detail="No authority data is available yet." />

  const { overall, engines, markets, topOpportunities, alerts, competitors, integrations } = data

  const measuredMarkets = markets.filter((m) => m.measuredAt !== null)
  const needsAttention = measuredMarkets
    .filter((m) => (m.current?.internalVisibilityScore ?? 0) < 25)
    .slice(0, 5)

  const strongestMarkets = [...measuredMarkets]
    .sort(
      (a, b) =>
        (b.current?.internalVisibilityScore ?? 0) - (a.current?.internalVisibilityScore ?? 0)
    )
    .slice(0, 3)

  const gainingCompetitors = [...competitors]
    .filter((c) => (c.mentionDelta ?? 0) > 0)
    .sort((a, b) => (b.mentionDelta ?? 0) - (a.mentionDelta ?? 0))
    .slice(0, 3)

  const configuredEngines = engines.filter((e) => e.capability === 'supported')
  const unconfiguredEngines = engines.filter((e) => e.capability !== 'supported')

  return (
    <Container className="py-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">AI Authority Command Center</h1>
          <p className="text-slate-400 mt-1">
            Straight Flush Plumbing &amp; Leak Detection ·{' '}
            <a
              className="text-sky-400 hover:text-sky-300"
              href="https://straightflushplumbingoc.com/"
              target="_blank"
              rel="noreferrer noopener"
            >
              straightflushplumbingoc.com
            </a>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Window: last {data.windowDays} days · generated {formatRelative(data.generatedAt)}
          </p>
        </div>
      </header>

      <MetricDisclosure text={data.metricDisclosure} />

      {data.overall.marketsTotal === 0 && (
        <AuthoritySeedPrompt organizationId={organizationId} onSeeded={reload} />
      )}

      <Section
        title="Overall"
        subtitle="Averages across every market that has been measured. Unmeasured markets are excluded rather than counted as zero."
      >
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
          <Stat label="Internal visibility" value={overall.internalVisibilityScore ?? '—'} />
          <Stat label="Mention rate" value={formatPercent(overall.internalMentionRate)} />
          <Stat label="First-mention rate" value={formatPercent(overall.internalFirstMentionRate)} />
          <Stat label="Citation rate" value={formatPercent(overall.internalCitationRate)} />
          <Stat
            label="Website citation rate"
            value={formatPercent(overall.internalWebsiteCitationRate)}
          />
          <Stat label="Internal authority" value={overall.internalAuthorityScore ?? '—'} />
          <Stat
            label="Competitor pressure"
            value={overall.competitorPressure ?? '—'}
            tone={(overall.competitorPressure ?? 0) > 60 ? 'warn' : 'default'}
          />
          <Stat
            label="Markets measured"
            value={`${overall.marketsMeasured} / ${overall.marketsTotal}`}
            tone={overall.marketsMeasured < overall.marketsTotal ? 'warn' : 'good'}
          />
          <Stat label="Open opportunities" value={overall.opportunityCount} />
          <Stat
            label="Open alerts"
            value={overall.openAlertCount}
            tone={overall.openAlertCount > 0 ? 'warn' : 'good'}
          />
        </div>
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section
          title="Cities and services needing attention"
          subtitle="Measured markets with the lowest internal visibility. These are the strongest candidates for new evidence and content, subject to approval."
        >
          {needsAttention.length === 0 ? (
            <EmptyState
              title="No weakly measured markets"
              detail={
                measuredMarkets.length === 0
                  ? 'No market has been measured yet. Run AI query collection to produce a first measurement.'
                  : 'Every measured market is at or above the attention threshold.'
              }
            />
          ) : (
            <ul className="space-y-3">
              {needsAttention.map((market) => (
                <li
                  key={market.marketId}
                  className="flex items-center justify-between border-b border-slate-800 pb-2 last:border-0"
                >
                  <div>
                    <div className="text-sm text-white">
                      {market.locationName} · {market.serviceName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {market.responseCount} response{market.responseCount === 1 ? '' : 's'} collected ·
                      measured {formatDate(market.measuredAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums text-amber-400">
                      {market.current?.internalVisibilityScore ?? '—'}
                    </div>
                    <div className="text-xs text-slate-500">visibility</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Strongest measured markets"
          subtitle="Where the authority position is currently strongest. Protect these rather than rebuild them."
        >
          {strongestMarkets.length === 0 ? (
            <EmptyState title="Nothing measured yet" detail="Measurements appear once AI query runs complete." />
          ) : (
            <ul className="space-y-3">
              {strongestMarkets.map((market) => (
                <li
                  key={market.marketId}
                  className="flex items-center justify-between border-b border-slate-800 pb-2 last:border-0"
                >
                  <div>
                    <div className="text-sm text-white">
                      {market.locationName} · {market.serviceName}
                    </div>
                    <div className="text-xs text-slate-500">
                      mention {formatPercent(market.current?.internalMentionRate)} · citation{' '}
                      {formatPercent(market.current?.internalCitationRate)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums text-emerald-400">
                      {market.current?.internalVisibilityScore ?? '—'}
                    </div>
                    <div className="text-xs text-slate-500">visibility</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section
          title="AI engines"
          subtitle="Which engines this build can actually query, and which are waiting on a credential. An engine is never reported as monitored until it is configured."
        >
          <div className="space-y-3">
            {engines.map((engine) => (
              <div
                key={engine.key}
                className="flex items-start justify-between border-b border-slate-800 pb-3 last:border-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-white">{engine.displayName}</span>
                    {engine.capability === 'supported' ? (
                      <span className="text-xs text-emerald-400">configured</span>
                    ) : (
                      <span className="text-xs text-amber-400">awaiting credential</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {engine.model ?? 'no model set'} · last query {formatRelative(engine.lastQueryAt)}
                    {engine.lastError ? ` · last error: ${engine.lastError}` : ''}
                  </div>
                  {engine.capability !== 'supported' && engine.credentialEnvVar && (
                    <div className="text-xs text-slate-500 mt-0.5">
                      Requires <code className="text-slate-400">{engine.credentialEnvVar}</code>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0 ml-3">
                  <div className="text-sm tabular-nums text-slate-300">
                    {engine.stats.responsesCollected} responses
                  </div>
                  <div className="text-xs text-slate-500">
                    mention {formatPercent(engine.stats.mentionRate)}
                  </div>
                  {engine.stats.skipped > 0 && (
                    <div className="text-xs text-slate-500">{engine.stats.skipped} skipped</div>
                  )}
                </div>
              </div>
            ))}
            {unconfiguredEngines.length > 0 && (
              <p className="text-xs text-slate-500 pt-1 leading-relaxed">
                {unconfiguredEngines.length} engine
                {unconfiguredEngines.length === 1 ? ' is' : 's are'} not connected in this
                environment. No results are fabricated for an unconfigured engine; its queries are
                recorded as skipped.
              </p>
            )}
          </div>
        </Section>

        <Section
          title="Competitors gaining visibility"
          subtitle="Competitor mention change between the two most recent snapshots. Movement is reported, but a single snapshot pair does not establish a trend."
        >
          {gainingCompetitors.length === 0 ? (
            <EmptyState
              title="No competitor increase detected"
              detail="Either no competitor movement was recorded, or the system has not yet collected enough snapshots to compare."
            />
          ) : (
            <ul className="space-y-3">
              {gainingCompetitors.map((competitor) => (
                <li key={competitor.id} className="border-b border-slate-800 pb-2 last:border-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white">{competitor.name}</span>
                    <span className="text-sm tabular-nums text-amber-400">
                      {competitor.mentionDelta !== null && competitor.mentionDelta > 0 ? '+' : ''}
                      {competitor.mentionDelta} mentions
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {competitor.locations.length > 0
                      ? `seen in ${competitor.locations.slice(0, 3).join(', ')}`
                      : 'no city context recorded'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title="Top opportunities"
        subtitle="Ordered by the internal prioritisation heuristic. The explanation for each score is shown in full on the Opportunities view."
      >
        {topOpportunities.length === 0 ? (
          <EmptyState
            title="No prioritised opportunities"
            detail="Opportunities appear after market scores are computed and gaps are analysed."
          />
        ) : (
          <div className="space-y-4">
            {topOpportunities.slice(0, 5).map((opportunity) => (
              <div key={opportunity.id} className="border border-slate-800 rounded-lg p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-medium">{opportunity.title}</span>
                      <SeverityBadge severity={opportunity.priority} />
                      <ApprovalBadge approvalClass={opportunity.approval_class} />
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {opportunity.category.replace(/_/g, ' ')}
                      {opportunity.location_name ? ` · ${opportunity.location_name}` : ''}
                      {opportunity.service_name ? ` · ${opportunity.service_name}` : ''}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-semibold tabular-nums text-sky-400">
                      {opportunity.opportunity_score}
                    </div>
                    <div className="text-xs text-slate-500">internal score</div>
                  </div>
                </div>

                {opportunity.why && (
                  <p className="text-sm text-slate-400 mt-3 leading-relaxed">{opportunity.why}</p>
                )}
              </div>
            ))}
            <Link
              href={`/headquarters/${organizationId}/authority/opportunities`}
              className="inline-block text-sm text-sky-400 hover:text-sky-300"
            >
              View all opportunities →
            </Link>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Open alerts" subtitle="Changes the system judged significant enough to surface.">
          {alerts.length === 0 ? (
            <EmptyState
              title="No open alerts"
              detail="Alerts are raised when a monitored value moves beyond its configured threshold."
            />
          ) : (
            <ul className="space-y-3">
              {alerts.slice(0, 6).map((alert) => (
                <li key={alert.id} className="border-b border-slate-800 pb-2 last:border-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <SeverityBadge severity={alert.severity} />
                    <span className="text-sm text-white">{alert.title}</span>
                  </div>
                  {alert.detail && (
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{alert.detail}</p>
                  )}
                  <div className="text-xs text-slate-600 mt-0.5">
                    {alert.alert_type.replace(/_/g, ' ')} · {formatRelative(alert.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Data integrations"
          subtitle="Search Console and Business Profile data improve query generation and measurement. Each requires its own authorized credential."
        >
          {integrations.length === 0 ? (
            <EmptyState
              title="No integrations configured"
              detail="The engine operates without them, using AI answers and website data only. Connect Search Console to ground query generation in real search demand."
            />
          ) : (
            <ul className="space-y-3">
              {integrations.map((integration) => (
                <li
                  key={integration.provider}
                  className="flex items-center justify-between border-b border-slate-800 pb-2 last:border-0"
                >
                  <div>
                    <div className="text-sm text-white">{integration.displayName}</div>
                    <div className="text-xs text-slate-500">
                      {integration.status} · last sync {formatRelative(integration.lastSyncAt)}
                    </div>
                    {integration.missingEnvVars.length > 0 && (
                      <div className="text-xs text-amber-400 mt-0.5">
                        Missing: {integration.missingEnvVars.join(', ')}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title="Monitored markets"
        subtitle={`All ${data.markets.length} configured city × service markets, ordered by internal visibility.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <th className="py-2 pr-4">City</th>
                <th className="py-2 pr-4">Service</th>
                <th className="py-2 pr-4 text-right">Visibility</th>
                <th className="py-2 pr-4 text-right">Mention</th>
                <th className="py-2 pr-4 text-right">Citation</th>
                <th className="py-2 pr-4 text-right">Responses</th>
                <th className="py-2 text-right">Measured</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((market) => (
                <tr key={market.marketId} className="border-b border-slate-800/60">
                  <td className="py-2 pr-4 text-slate-200">{market.locationName}</td>
                  <td className="py-2 pr-4 text-slate-400">{market.serviceName}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-200">
                    {market.current?.internalVisibilityScore ?? '—'}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-400">
                    {formatPercent(market.current?.internalMentionRate)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-400">
                    {formatPercent(market.current?.internalCitationRate)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums text-slate-500">
                    {formatNumber(market.responseCount)}
                  </td>
                  <td className="py-2 text-right text-slate-500">
                    {market.measuredAt ? formatDate(market.measuredAt) : 'not measured'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <p className="text-xs text-slate-600 leading-relaxed">
        Monitoring engines configured: {configuredEngines.length} of {engines.length}. The objective
        is to continuously improve the probability that Straight Flush is discovered, cited, and
        recommended. No ranking is guaranteed, and no AI platform ranking formula is represented
        here.
      </p>
    </Container>
  )
}