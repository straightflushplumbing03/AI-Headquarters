'use client'

import { Container } from '@/components/Container'
import { authorityApi } from '@/lib/authority/api-client'
import {
  EmptyState,
  ErrorState,
  LoadingState,
  MetricDisclosure,
  Section,
} from '@/components/authority/ui'
import { formatNumber, useAuthority } from '@/components/authority/use-authority'

/**
 * Service view.
 *
 * Shows authority per service across its cities. `averageInternalVisibility` is
 * null when nothing has been measured, and is rendered as a dash rather than 0,
 * because an unmeasured service is not a failing service.
 */
export function AuthorityServices() {
  const { data, loading, error, reload } = useAuthority(authorityApi.services)

  if (loading) return <LoadingState label="Loading services" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <EmptyState title="No services" detail="No services are configured." />

  return (
    <Container className="py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Service Authority</h1>
        <p className="text-slate-400 mt-1">
          Authority position for each tracked service across its monitored cities.
        </p>
      </header>

      <MetricDisclosure text={data.metricDisclosure} />

      {data.services.length === 0 ? (
        <EmptyState title="No services configured" detail="Seed the service taxonomy to begin." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data.services.map((service) => (
            <Section
              key={service.serviceId}
              title={service.name}
              subtitle={`${service.tier} service · ${service.citiesTracked} cities tracked, ${service.citiesMeasured} measured`}
            >
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Avg visibility</div>
                  <div className="text-xl font-bold tabular-nums text-white">
                    {service.averageInternalVisibility ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Evidence</div>
                  <div className="text-xl font-bold tabular-nums text-white">
                    {formatNumber(service.evidenceTotal)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {formatNumber(service.evidencePublished)} publishable
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Cities</div>
                  <div className="text-xl font-bold tabular-nums text-white">
                    {service.citiesTracked}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                      <th className="py-1.5 pr-3">City</th>
                      <th className="py-1.5 pr-3 text-right">Visibility</th>
                      <th className="py-1.5 pr-3 text-right">Evidence</th>
                      <th className="py-1.5 text-right">Page</th>
                    </tr>
                  </thead>
                  <tbody>
                    {service.markets.map((market) => (
                      <tr key={market.marketId} className="border-b border-slate-800/60">
                        <td className="py-1.5 pr-3 text-slate-200">{market.locationName}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-slate-300">
                          {market.internalVisibilityScore ?? '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400">
                          {formatNumber(market.evidenceCount)}
                        </td>
                        <td className="py-1.5 text-right">
                          {market.hasPage ? (
                            <span className="text-emerald-400 text-xs">linked</span>
                          ) : (
                            <span className="text-amber-400 text-xs">missing</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {service.markets.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-3 text-center text-slate-600 text-xs">
                          No cities configured for this service.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-600 leading-relaxed">
        Evidence counts include only items recorded in Business Brain. Unverified and
        non-publishable evidence is counted separately because it cannot yet support a public claim.
      </p>
    </Container>
  )
}