'use client'

import { useState } from 'react'
import { Container } from '@/components/Container'
import { authorityApi } from '@/lib/authority/api-client'
import {
  Badge,
  Disclosure,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricDisclosure,
  Section,
} from '@/components/authority/ui'
import { formatDateTime, formatNumber, useAuthority } from '@/components/authority/use-authority'

/**
 * AI Response Explorer.
 *
 * Opens the actual answers the system collected, so a reader can verify any
 * claim made elsewhere in this section. The RAW provider text is shown verbatim
 * and separately from the parser output, because the value of this screen
 * depends on the two never being confused.
 */
export function AuthorityResponses() {
  const { data, loading, error, reload } = useAuthority((organizationId) =>
    authorityApi.responses(organizationId, 100)
  )
  const [selected, setSelected] = useState<string | null>(null)
  const { data: detail, loading: detailLoading } = useAuthority(
    (organizationId) => (selected ? authorityApi.responseDetail(organizationId, selected) : Promise.resolve(null)),
    [selected]
  )

  if (loading) return <LoadingState label="Loading responses" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <EmptyState title="No responses" detail="No AI responses have been collected." />

  return (
    <Container className="py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">AI Response Explorer</h1>
        <p className="text-slate-400 mt-1">
          Every answer this system collected, with its parsing result. Open a row to read the
          original text.
        </p>
      </header>

      <MetricDisclosure text={data.note ?? data.metricDisclosure} />

      {data.responses.length === 0 ? (
        <Section title="No responses collected">
          <EmptyState
            title="Nothing to explore yet"
            detail="Responses appear here after AI query runs complete against a configured engine."
          />
        </Section>
      ) : (
        <Section title={`${data.responses.length} most recent responses`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-4">Captured</th>
                  <th className="py-2 pr-4">Engine</th>
                  <th className="py-2 pr-4">Model</th>
                  <th className="py-2 pr-4">Mentioned</th>
                  <th className="py-2 pr-4">Position</th>
                  <th className="py-2 pr-4">Cited</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {data.responses.map((response) => (
                  <tr key={response.id} className="border-b border-slate-800/60">
                    <td className="py-2 pr-4 text-slate-300">{formatDateTime(response.capturedAt)}</td>
                    <td className="py-2 pr-4 text-slate-400">{response.engineKey ?? '—'}</td>
                    <td className="py-2 pr-4 text-slate-500">{response.model ?? '—'}</td>
                    <td className="py-2 pr-4">
                      {response.mentioned ? (
                        <Badge tone="green">yes</Badge>
                      ) : (
                        <Badge tone="neutral">no</Badge>
                      )}
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-slate-400">
                      {formatNumber(response.position)}
                    </td>
                    <td className="py-2 pr-4">
                      {response.cited ? (
                        <Badge tone="green">yes</Badge>
                      ) : (
                        <Badge tone="neutral">no</Badge>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => setSelected(selected === response.id ? null : response.id)}
                        className="text-xs text-sky-400 hover:text-sky-300"
                      >
                        {selected === response.id ? 'Hide' : 'Open'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {selected && (
        <Section title="Response detail" subtitle="The verbatim provider answer and its parsed structure.">
          {detailLoading && <LoadingState label="Loading response" />}
          {!detailLoading && detail && <ResponseDetail detail={detail} />}
          {!detailLoading && !detail && (
            <EmptyState title="No detail available" detail="This response could not be loaded." />
          )}
        </Section>
      )}
    </Container>
  )
}

function ResponseDetail({ detail }: { detail: Record<string, unknown> }) {
  const response = detail.response as Record<string, unknown> | undefined
  const engine = detail.engine as Record<string, unknown> | null | undefined
  const query = detail.query as Record<string, unknown> | null | undefined
  const mentions = (detail.mentions ?? []) as Array<Record<string, unknown>>
  const citations = (detail.citations ?? []) as Array<Record<string, unknown>>

  if (!response) {
    return <EmptyState title="No response body" detail="The stored response could not be read." />
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Query</div>
          <p className="text-slate-200">{String(query?.raw_text ?? '—')}</p>
          {query?.normalized_text ? (
            <p className="text-xs text-slate-500 mt-1">
              Normalized: {String(query.normalized_text)}
            </p>
          ) : null}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Engine</div>
          <p className="text-slate-200">
            {String(engine?.display_name ?? '—')}
            {response.model ? ` · ${String(response.model)}` : ''}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Captured {formatDateTime(String(response.captured_at ?? ''))}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-slate-500">
          Mentioned:{' '}
          <span className={response.straight_flush_mentioned ? 'text-emerald-400' : 'text-slate-300'}>
            {response.straight_flush_mentioned ? 'yes' : 'no'}
          </span>
        </span>
        <span className="text-slate-500">
          Position:{' '}
          <span className="text-slate-300">{String(response.straight_flush_position ?? '—')}</span>
        </span>
        <span className="text-slate-500">
          Cited:{' '}
          <span className={response.straight_flush_cited ? 'text-emerald-400' : 'text-slate-300'}>
            {response.straight_flush_cited ? 'yes' : 'no'}
          </span>
        </span>
      </div>

      <Disclosure summary="Verbatim provider answer">
        <pre className="whitespace-pre-wrap break-words text-slate-300 text-sm max-h-96 overflow-y-auto">
          {String(response.raw_response_text ?? '')}
        </pre>
      </Disclosure>

      <Disclosure summary={`Businesses mentioned (${mentions.length})`}>
        {mentions.length === 0 ? (
          <p className="text-slate-500">No businesses were extracted from this answer.</p>
        ) : (
          <ul className="space-y-2">
            {mentions.map((mention, index) => (
              <li key={index} className="border-b border-slate-800 pb-2 last:border-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-200">{String(mention.business_name ?? '—')}</span>
                  <Badge tone="neutral">position {String(mention.position ?? '—')}</Badge>
                  {mention.is_subject ? <Badge tone="green">our business</Badge> : null}
                </div>
                {mention.recommendation_language ? (
                  <p className="text-xs text-slate-500 mt-0.5">
                    Language: {String(mention.recommendation_language)}
                  </p>
                ) : null}
                {mention.service_context ? (
                  <p className="text-xs text-slate-500">Service: {String(mention.service_context)}</p>
                ) : null}
                {mention.location_context ? (
                  <p className="text-xs text-slate-500">City: {String(mention.location_context)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Disclosure>

      <Disclosure summary={`Citations (${citations.length})`}>
        {citations.length === 0 ? (
          <p className="text-slate-500">No citations were attached to this answer.</p>
        ) : (
          <ul className="space-y-1">
            {citations.map((citation, index) => (
              <li key={index} className="text-xs">
                <span className="text-slate-300">{String(citation.domain ?? '—')}</span>
                <span className="text-slate-600 ml-2">
                  {String(citation.source_type ?? 'unclassified')}
                </span>
                {citation.url ? (
                  <a
                    className="block text-sky-500 hover:text-sky-400 break-all"
                    href={String(citation.url)}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {String(citation.url)}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Disclosure>

      <p className="text-xs text-slate-600 leading-relaxed">
        The stored answer is the provider&apos;s verbatim output. Parsing results are stored
        separately and never overwrite it, so the record can always be re-checked against the
        original.
      </p>
    </div>
  )
}