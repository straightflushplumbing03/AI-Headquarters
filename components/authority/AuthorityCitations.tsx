'use client'

import { Container } from '@/components/Container'
import { authorityApi } from '@/lib/authority/api-client'
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricDisclosure,
  Meter,
  Section,
} from '@/components/authority/ui'
import { formatNumber, formatPercent, useAuthority } from '@/components/authority/use-authority'

/**
 * Citation intelligence view.
 *
 * The distinction between first-party and third-party citation is the core
 * insight here: an engine that only ever cites our own website is relying on a
 * single source. The view reports the split and lists evaluated opportunities --
 * it never presents a gap as an instruction to buy links.
 */
export function AuthorityCitations() {
  const { data, loading, error, reload } = useAuthority(authorityApi.citations)

  if (loading) return <LoadingState label="Loading citations" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <EmptyState title="No citations" detail="No citations have been recorded." />

  const firstParty = data.domains.filter((d) => d.firstParty)
  const thirdParty = data.domains.filter((d) => !d.firstParty)

  return (
    <Container className="py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Citations &amp; Sources</h1>
        <p className="text-slate-400 mt-1">
          Which sources the AI answers actually draw on when they discuss Straight Flush and its
          competitors.
        </p>
      </header>

      <MetricDisclosure text={data.policy ?? data.metricDisclosure} />

      <Section title="Source split" subtitle="Citations observed across every collected answer.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Total citations</div>
            <div className="text-2xl font-bold tabular-nums text-white">
              {formatNumber(data.totalCitations)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">First-party</div>
            <div className="text-2xl font-bold tabular-nums text-emerald-400">
              {formatNumber(data.firstPartyCitations)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Third-party</div>
            <div className="text-2xl font-bold tabular-nums text-sky-400">
              {formatNumber(data.thirdPartyCitations)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">First-party share</div>
            <div className="text-2xl font-bold tabular-nums text-white">
              {formatPercent(data.firstPartyShare)}
            </div>
          </div>
        </div>

        <Meter
          value={data.firstPartyShare}
          label="Share of citations that are our own website"
          tone={data.firstPartyShare >= 70 ? 'amber' : 'emerald'}
        />

        {data.firstPartyShare >= 70 && data.totalCitations > 0 && (
          <p className="text-xs text-amber-400/90 mt-4 leading-relaxed border-l-2 border-amber-900 pl-3">
            Most observed citations point at our own website. That is a citation diversification
            opportunity: a presence supported only by first-party sources is more fragile than one
            corroborated by independent references.
          </p>
        )}
      </Section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section
          title="First-party sources"
          subtitle="Domains belonging to Straight Flush."
        >
          {firstParty.length === 0 ? (
            <EmptyState title="None observed" detail="No first-party source has been cited in the collected answers." />
          ) : (
            <ul className="space-y-2">
              {firstParty.map((domain) => (
                <li
                  key={domain.domain}
                  className="flex items-center justify-between border-b border-slate-800 pb-2 last:border-0"
                >
                  <div>
                    <div className="text-sm text-slate-200">{domain.domain}</div>
                    <div className="text-xs text-slate-500">{domain.sourceType.replace(/_/g, ' ')}</div>
                  </div>
                  <span className="text-sm tabular-nums text-slate-400">{domain.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Third-party sources"
          subtitle="Independent domains cited alongside us. These are the corroborating sources AI answers trust."
        >
          {thirdParty.length === 0 ? (
            <EmptyState
              title="No third-party sources observed"
              detail="No independent source has been cited in the collected answers. This is itself a finding worth investigating."
            />
          ) : (
            <ul className="space-y-2">
              {thirdParty.map((domain) => (
                <li
                  key={domain.domain}
                  className="flex items-center justify-between border-b border-slate-800 pb-2 last:border-0"
                >
                  <div>
                    <div className="text-sm text-slate-200">{domain.domain}</div>
                    <div className="text-xs text-slate-500">{domain.sourceType.replace(/_/g, ' ')}</div>
                  </div>
                  <span className="text-sm tabular-nums text-slate-400">{domain.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title="Citation gaps"
        subtitle="Source types where competitors are cited and we are not. Each is an opportunity to EVALUATE eligibility, not an instruction to acquire a link."
      >
        {data.gaps.length === 0 ? (
          <EmptyState
            title="No citation gaps recorded"
            detail="Gaps are identified when competitor citations are compared against our own across enough answers."
          />
        ) : (
          <ul className="space-y-3">
            {data.gaps.map((gap) => (
              <li key={gap.id} className="border border-slate-800 rounded-lg p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="yellow">{String(gap.source_type ?? 'unclassified').replace(/_/g, ' ')}</Badge>
                  <Badge tone="neutral">{gap.status}</Badge>
                </div>
                {gap.detail && (
                  <p className="text-sm text-slate-300 mt-2 leading-relaxed">{gap.detail}</p>
                )}
                {(gap.competitor_share !== null || gap.our_share !== null) && (
                  <p className="text-xs text-slate-500 mt-1 tabular-nums">
                    competitor share {gap.competitor_share ?? '—'}% · our share {gap.our_share ?? '—'}%
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="text-xs text-slate-600 leading-relaxed">
        The system does not purchase links, submit mass directory listings, or fabricate coverage.
        Citation work means identifying genuinely eligible, legitimate sources and pursuing them
        with real evidence and human approval.
      </p>
    </Container>
  )
}