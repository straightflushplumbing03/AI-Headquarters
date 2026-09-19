'use client'

import { useState } from 'react'
import { Container } from '@/components/Container'
import { authorityApi, type OpportunityCard } from '@/lib/authority/api-client'
import {
  ApprovalBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricDisclosure,
  Section,
  SeverityBadge,
} from '@/components/authority/ui'
import { formatRelative, useAuthority } from '@/components/authority/use-authority'

/**
 * Opportunity view.
 *
 * Each opportunity renders the full WHAT / WHY / EVIDENCE / IMPACT / ACTION /
 * RISK / APPROVAL / MEASUREMENT structure. This is the product requirement that
 * the system explain itself: a score alone is not actionable, and a
 * recommendation a human cannot audit is not one they should approve.
 */

const CATEGORY_LABELS: Record<string, string> = {
  authority_gap: 'Authority gap',
  content_gap: 'Content gap',
  citation_gap: 'Citation gap',
  evidence_gap: 'Evidence gap',
  technical_seo: 'Technical SEO',
  internal_linking: 'Internal linking',
  competitor_pressure: 'Competitor pressure',
  expansion: 'Expansion',
}

const STATUSES = ['prioritized', 'accepted', 'dismissed', 'completed'] as const

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-0.5">{label}</div>
      <p className="text-sm text-slate-300 leading-relaxed">{value}</p>
    </div>
  )
}

function OpportunityDetail({ opportunity }: { opportunity: OpportunityCard }) {
  return (
    <div className="space-y-3 mt-4 pt-4 border-t border-slate-800">
      <Field label="What needs attention" value={opportunity.what} />
      <Field label="Why the system identified it" value={opportunity.why} />
      <Field label="Evidence" value={opportunity.evidence} />
      <Field label="Potential impact" value={opportunity.impact} />
      <Field label="Recommended action" value={opportunity.action} />
      <Field label="Risk" value={opportunity.risk} />
      <Field label="How success will be measured" value={opportunity.measurement} />

      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-0.5">
          Why this was prioritised
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          {opportunity.score_explanation ??
            'No component breakdown was stored for this opportunity.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 pt-1">
        <ApprovalBadge approvalClass={opportunity.approval_class} />
        <span>Created {formatRelative(opportunity.created_at)}</span>
      </div>
    </div>
  )
}

export function AuthorityOpportunities() {
  const [status, setStatus] = useState<string>('prioritized')
  const { data, loading, error, reload } = useAuthority(
    (organizationId) => authorityApi.opportunities(organizationId, status, 200),
    [status]
  )
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <Container className="py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Opportunities</h1>
        <p className="text-slate-400 mt-1">
          Explainable, prioritised opportunities to strengthen authority. Each one states its own
          evidence, risk, and measurement plan.
        </p>
      </header>

      <MetricDisclosure text={data?.policy ?? data?.metricDisclosure} />

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((value) => (
          <button
            key={value}
            onClick={() => setStatus(value)}
            className={`text-sm px-3 py-1.5 rounded border transition-colors ${
              status === value
                ? 'border-sky-700 bg-sky-950 text-sky-300'
                : 'border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      {loading && <LoadingState label="Loading opportunities" />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && data && data.opportunities.length === 0 && (
        <Section title="No opportunities in this state">
          <EmptyState
            title={`Nothing with status "${status}"`}
            detail="Opportunities are created by the analysis pipeline after market scores are computed. Try another status, or run the analysis job to generate them."
          />
        </Section>
      )}

      {!loading && !error && data && data.opportunities.length > 0 && (
        <div className="space-y-4">
          {data.opportunities.map((opportunity) => {
            const isOpen = expanded === opportunity.id
            return (
              <div
                key={opportunity.id}
                className="bg-slate-900 border border-slate-800 rounded-xl p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-medium">{opportunity.title}</span>
                      <SeverityBadge severity={opportunity.priority} />
                      <ApprovalBadge approvalClass={opportunity.approval_class} />
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {CATEGORY_LABELS[opportunity.category] ?? opportunity.category.replace(/_/g, ' ')}
                      {opportunity.location_name ? ` · ${opportunity.location_name}` : ''}
                      {opportunity.service_name ? ` · ${opportunity.service_name}` : ''}
                      {' · '}
                      {opportunity.status}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xl font-bold tabular-nums text-sky-400">
                      {opportunity.opportunity_score}
                    </div>
                    <div className="text-xs text-slate-500">internal priority score</div>
                  </div>
                </div>

                {opportunity.why && !isOpen && (
                  <p className="text-sm text-slate-400 mt-3 leading-relaxed">{opportunity.why}</p>
                )}

                {isOpen && <OpportunityDetail opportunity={opportunity} />}

                <button
                  onClick={() => setExpanded(isOpen ? null : opportunity.id)}
                  className="mt-3 text-xs text-sky-400 hover:text-sky-300"
                >
                  {isOpen ? 'Hide detail' : 'Show full reasoning'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-slate-600 leading-relaxed">
        The priority score is a Business Brain heuristic that multiplies visibility gap, customer
        value, competitive opportunity, evidence availability, and probability of improvement. It is
        not a platform ranking and it is not a prediction. Every component is stored so the ordering
        can be audited.
      </p>
    </Container>
  )
}