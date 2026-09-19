'use client'

import { useState } from 'react'
import { Container } from '@/components/Container'
import { authorityApi, type RecommendationView } from '@/lib/authority/api-client'
import {
  ApprovalBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricDisclosure,
  Section,
} from '@/components/authority/ui'
import { formatRelative, useAuthority } from '@/components/authority/use-authority'

/**
 * Recommendation view -- the human control point.
 *
 * Approving here does NOT publish anything. It records a human decision against
 * the existing approval record and lets the existing execution engine decide
 * what happens next. This separation is stated in the UI so nobody assumes that
 * clicking approve ships a page.
 *
 * Green-class steps are not listed as approvable: they require no human
 * decision. Red-class steps cannot be approved here at all.
 */
export function AuthorityRecommendations() {
  const { organizationId, data, loading, error, reload } = useAuthority(
    authorityApi.recommendations
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)

  if (loading) return <LoadingState label="Loading recommendations" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <EmptyState title="No recommendations" detail="No recommendations have been generated." />

  const pending = data.recommendations.filter(
    (r) => r.approval_class === 'yellow' && (!r.approval || r.approval.approval_status === 'pending')
  )
  const decided = data.recommendations.filter((r) => r.approval && r.approval.approval_status !== 'pending')
  const automatic = data.recommendations.filter((r) => r.approval_class === 'green')
  const redClass = data.recommendations.filter((r) => r.approval_class === 'red')

  const decide = async (recommendation: RecommendationView, decision: 'approve' | 'reject') => {
    if (!recommendation.action_id) {
      setActionError('This recommendation has no linked action and cannot be decided.')
      return
    }
    if (!organizationId) {
      setActionError('No organization selected.')
      return
    }

    setBusy(recommendation.action_id)
    setActionError(null)
    setActionNote(null)
    try {
      const result = await authorityApi.decide(organizationId, recommendation.action_id, decision)
      setActionNote(result.note)
      await reload()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Decision failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Container className="py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Recommendations &amp; Approvals</h1>
        <p className="text-slate-400 mt-1">
          {pending.length} step{pending.length === 1 ? '' : 's'} awaiting a human decision.
        </p>
      </header>

      <MetricDisclosure text={data.metricDisclosure ?? data.note} />

      <p className="text-xs text-slate-400 leading-relaxed border-l-2 border-sky-900 pl-3">
        Approving a step records your decision on the existing approval record. It does not itself
        publish or change anything customer-facing. Publication remains the responsibility of the
        existing execution engine, which independently re-checks risk and kill switches before
        acting.
      </p>

      {actionError && (
        <div className="text-sm text-rose-400 border border-rose-900 bg-rose-950/40 rounded-lg px-4 py-3">
          {actionError}
        </div>
      )}
      {actionNote && (
        <div className="text-sm text-emerald-300 border border-emerald-900 bg-emerald-950/40 rounded-lg px-4 py-3">
          {actionNote}
        </div>
      )}

      <Section
        title="Awaiting approval"
        subtitle="Customer-facing changes the system recommends but will not perform without authorization."
      >
        {pending.length === 0 ? (
          <EmptyState
            title="Nothing awaiting approval"
            detail="Either no customer-facing recommendation is pending, or the recommendations pipeline has not run yet."
          />
        ) : (
          <ul className="space-y-4">
            {pending.map((recommendation) => (
              <li key={recommendation.id} className="border border-slate-800 rounded-lg p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-medium">{recommendation.title}</span>
                      <ApprovalBadge approvalClass={recommendation.approval_class} />
                    </div>
                    {recommendation.description && (
                      <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                        {recommendation.description}
                      </p>
                    )}
                  </div>
                </div>

                {recommendation.opportunity && (
                  <div className="mt-3 pt-3 border-t border-slate-800 space-y-2">
                    {recommendation.opportunity.why && (
                      <p className="text-xs text-slate-400 leading-relaxed">
                        <span className="text-slate-500">Why: </span>
                        {recommendation.opportunity.why}
                      </p>
                    )}
                    {recommendation.opportunity.impact && (
                      <p className="text-xs text-slate-400 leading-relaxed">
                        <span className="text-slate-500">Impact: </span>
                        {recommendation.opportunity.impact}
                      </p>
                    )}
                    {recommendation.opportunity.risk && (
                      <p className="text-xs text-amber-400/90 leading-relaxed">
                        <span className="text-slate-500">Risk: </span>
                        {recommendation.opportunity.risk}
                      </p>
                    )}
                    {recommendation.opportunity.measurement && (
                      <p className="text-xs text-slate-400 leading-relaxed">
                        <span className="text-slate-500">Measurement: </span>
                        {recommendation.opportunity.measurement}
                      </p>
                    )}
                    <p className="text-xs text-slate-600">
                      Internal priority score: {recommendation.opportunity.opportunityScore}
                    </p>
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => decide(recommendation, 'approve')}
                    disabled={busy === recommendation.action_id}
                    className="text-sm px-3 py-1.5 rounded border border-emerald-800 bg-emerald-950 text-emerald-300 hover:bg-emerald-900 disabled:opacity-50"
                  >
                    {busy === recommendation.action_id ? 'Working…' : 'Approve'}
                  </button>
                  <button
                    onClick={() => decide(recommendation, 'reject')}
                    disabled={busy === recommendation.action_id}
                    className="text-sm px-3 py-1.5 rounded border border-rose-900 bg-rose-950 text-rose-300 hover:bg-rose-900 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Decided" subtitle="Human decisions already recorded, with the reason if one was given.">
        {decided.length === 0 ? (
          <EmptyState title="No decisions recorded" detail="Decisions appear here once a human responds to a recommendation." />
        ) : (
          <ul className="space-y-3">
            {decided.map((recommendation) => (
              <li
                key={recommendation.id}
                className="flex items-start justify-between border-b border-slate-800 pb-2 last:border-0"
              >
                <div className="min-w-0">
                  <div className="text-sm text-slate-200">{recommendation.title}</div>
                  {recommendation.decision_reason && (
                    <p className="text-xs text-slate-500 mt-0.5">{recommendation.decision_reason}</p>
                  )}
                </div>
                <span
                  className={`text-xs shrink-0 ml-3 ${
                    recommendation.approval?.approval_status === 'approved'
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {recommendation.approval?.approval_status ?? recommendation.status}
                  {recommendation.decided_at ? ` · ${formatRelative(recommendation.decided_at)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Runs automatically"
        subtitle="Green-class steps: monitoring, analysis, and internal planning. These require no human decision and are listed for transparency."
      >
        {automatic.length === 0 ? (
          <EmptyState title="No automatic steps recorded" detail="Green-class work is logged in the audit trail as it runs." />
        ) : (
          <ul className="space-y-2">
            {automatic.map((recommendation) => (
              <li key={recommendation.id} className="text-sm text-slate-400 border-b border-slate-800 pb-2 last:border-0">
                {recommendation.title}
                <span className="text-xs text-slate-600 ml-2">{recommendation.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {redClass.length > 0 && (
        <Section
          title="Requires explicit approval"
          subtitle="Spending, external profiles, customer contact, and legally sensitive changes. These are never queued for autonomous execution and cannot be approved from this screen."
        >
          <ul className="space-y-2">
            {redClass.map((recommendation) => (
              <li key={recommendation.id} className="text-sm text-slate-400 border-b border-slate-800 pb-2 last:border-0">
                {recommendation.title}
                <ApprovalBadge approvalClass="red" />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Container>
  )
}