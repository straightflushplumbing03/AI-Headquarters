'use client'

import { Container } from '@/components/Container'
import { authorityApi } from '@/lib/authority/api-client'
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  Section,
  SeverityBadge,
} from '@/components/authority/ui'
import { formatNumber, useAuthority } from '@/components/authority/use-authority'

/**
 * Technical SEO and data-quality view.
 *
 * Explicitly read-only. Every row here is a finding with the evidence that
 * produced it. Nothing on this page changes the production site, and the UI says
 * so, because a list of "issues" invites the assumption that something is being
 * fixed automatically.
 */

const ISSUE_LABELS: Record<string, string> = {
  broken_link: 'Broken link',
  http_error: 'HTTP error',
  redirect_chain: 'Redirect chain',
  canonical_mismatch: 'Canonical mismatch',
  duplicate_title: 'Duplicate title',
  duplicate_meta_description: 'Duplicate meta description',
  missing_title: 'Missing title',
  missing_meta_description: 'Missing meta description',
  missing_h1: 'Missing H1',
  missing_schema: 'Missing structured data',
  invalid_schema: 'Invalid structured data',
  orphan_page: 'Orphan page',
  sitemap_problem: 'Sitemap problem',
  robots_issue: 'Robots issue',
  slow_page: 'Slow page',
  mobile_issue: 'Mobile issue',
  thin_content: 'Thin content',
  doorway_page_risk: 'Doorway page risk',
  duplicate_content: 'Duplicate content',
}

export function AuthorityQuality() {
  const { data, loading, error, reload } = useAuthority(authorityApi.quality)

  if (loading) return <LoadingState label="Loading technical findings" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <EmptyState title="No findings" detail="No technical findings are available." />

  const severityOrder = ['critical', 'high', 'medium', 'low']
  const grouped = severityOrder
    .map((severity) => ({
      severity,
      findings: data.findings.filter((f) => f.severity === severity),
    }))
    .filter((group) => group.findings.length > 0)

  return (
    <Container className="py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Technical SEO &amp; Data Quality</h1>
        <p className="text-slate-400 mt-1">
          {formatNumber(data.findingTotals.total)} finding
          {data.findingTotals.total === 1 ? '' : 's'} across the crawled site.
        </p>
      </header>

      <p className="text-xs text-slate-400 leading-relaxed border-l-2 border-sky-900 pl-3">
        {data.mutationPolicy}
      </p>

      <Section title="Findings by severity" subtitle="Each finding names the page, the problem, and the recommended correction.">
        {grouped.length === 0 ? (
          <EmptyState
            title="No open findings"
            detail="Either the site is clean or no crawl has run yet. Run a crawl from the Operations view to produce findings."
          />
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <div key={group.severity}>
                <div className="flex items-center gap-2 mb-2">
                  <SeverityBadge severity={group.severity} />
                  <span className="text-sm text-slate-400">
                    {group.findings.length} finding{group.findings.length === 1 ? '' : 's'}
                  </span>
                </div>
                <ul className="space-y-2">
                  {group.findings.slice(0, 40).map((finding, index) => (
                    <li
                      key={`${finding.url}-${finding.issueType}-${index}`}
                      className="border border-slate-800 rounded-lg p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral">
                          {ISSUE_LABELS[finding.issueType] ?? finding.issueType.replace(/_/g, ' ')}
                        </Badge>
                        <span className="text-xs text-slate-400 break-all">{finding.url}</span>
                      </div>
                      <p className="text-sm text-slate-300 mt-2 leading-relaxed">{finding.detail}</p>
                      <p className="text-xs text-sky-400/80 mt-1 leading-relaxed">
                        {finding.recommendation}
                      </p>
                    </li>
                  ))}
                </ul>
                {group.findings.length > 40 && (
                  <p className="text-xs text-slate-500 mt-2">
                    Showing the first 40 of {group.findings.length}. Findings are paginated server-side.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Internal link plan"
        subtitle="Links that would connect each city/service page to its supporting pages. Recommended, not applied."
      >
        {data.internalLinkPlan.length === 0 ? (
          <EmptyState
            title="No internal link recommendations"
            detail="Link recommendations require both a mapped market page and candidate supporting pages from a crawl."
          />
        ) : (
          <ul className="space-y-2">
            {data.internalLinkPlan.slice(0, 50).map((rec, index) => {
              const row = rec as Record<string, unknown>
              return (
                <li key={index} className="text-sm border-b border-slate-800 pb-2 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={row.priority === 'high' ? 'green' : 'neutral'}
                    >
                      {String(row.priority ?? 'medium')}
                    </Badge>
                    <Badge tone="info">{String(row.serviceName ?? '')}</Badge>
                    {row.locationName ? (
                      <span className="text-xs text-slate-500">{String(row.locationName)}</span>
                    ) : null}
                  </div>
                  <div className="mt-1">
                    <span className="text-slate-300 break-all">{String(row.fromUrl ?? '')}</span>
                    <span className="text-slate-600 mx-2">&rarr;</span>
                    <span className="text-slate-400 break-all">{String(row.toUrl ?? '')}</span>
                  </div>
                  {row.reason ? (
                    <div className="text-xs text-slate-500 mt-0.5">{String(row.reason)}</div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Doorway page policy" subtitle="The guardrail that keeps city pages genuinely distinct.">
        <p className="text-sm text-slate-400 leading-relaxed">{data.doorwayPolicy}</p>
      </Section>
    </Container>
  )
}