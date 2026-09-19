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
import { useAuthority } from '@/components/authority/use-authority'

/**
 * City × Service authority matrix.
 *
 * A cell is a monitored market: a specific service in a specific city. The view
 * makes the two things a reader must be able to tell apart explicit -- whether a
 * market EXISTS in the taxonomy, and whether it has actually been MEASURED. A
 * market with no score is shown as unmeasured, never as zero.
 */
export function AuthorityMarkets() {
  const { data, loading, error, reload } = useAuthority(authorityApi.markets)

  if (loading) return <LoadingState label="Loading markets" />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data) return <EmptyState title="No markets" detail="No city/service markets are configured." />

  const configured = data.matrix.reduce(
    (total, row) => total + row.services.filter((s) => s !== null).length,
    0
  )
  const possible = data.matrix.length * data.services.length

  return (
    <Container className="py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-white">Cities &amp; Services</h1>
        <p className="text-slate-400 mt-1">
          {configured} of {possible} possible city × service markets are configured across{' '}
          {data.locations.length} cities and {data.services.length} services.
        </p>
      </header>

      <MetricDisclosure text={data.metricDisclosure} />

      <Section
        title="Authority matrix"
        subtitle="Every primary city maps to every priority service. A configured market with no page or no score is a concrete starting point, not a failure."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-800">
                <th className="py-2 pr-4">City</th>
                {data.services.map((service) => (
                  <th key={service.id} className="py-2 pr-4 min-w-[190px]">
                    {service.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.matrix.map((row) => (
                <tr key={row.locationId} className="border-b border-slate-800/60">
                  <td className="py-3 pr-4 align-top">
                    <div className="text-slate-100">{row.locationName}</div>
                    <div className="text-xs text-slate-500">{row.tier} city</div>
                  </td>
                  {row.services.map((market, index) => (
                    <td key={market?.marketId ?? `${row.locationId}-${index}`} className="py-3 pr-4 align-top">
                      {market ? (
                        <div className="space-y-1">
                          <Badge tone={market.active ? 'info' : 'neutral'}>
                            {market.active ? 'monitored' : 'inactive'}
                          </Badge>
                          <div className="text-xs">
                            {market.hasPage ? (
                              <span className="text-emerald-400">page linked</span>
                            ) : (
                              <span className="text-amber-400">no page linked</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600">not configured</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Cities"
        subtitle="Configured service-area cities. Expansion candidates are added to the taxonomy without changing any code."
      >
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.locations.map((location) => (
            <li key={location.id} className="border border-slate-800 rounded-lg p-3">
              <div className="text-slate-100">{location.name}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                tier: {location.tier} · {location.is_service_area ? 'service area' : 'not a service area'}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Services"
        subtitle="Priority services form the initial authority matrix. Supporting services can be tracked without competing for the same content effort."
      >
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.services.map((service) => (
            <li key={service.id} className="border border-slate-800 rounded-lg p-3">
              <div className="text-slate-100">{service.name}</div>
              <div className="text-xs text-slate-500 mt-0.5">tier: {service.tier}</div>
            </li>
          ))}
        </ul>
      </Section>
    </Container>
  )
}