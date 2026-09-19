'use client'

import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { Container } from '@/components/Container'

/**
 * AI Authority section shell.
 *
 * Adds the sub-navigation for this subsystem and nothing else. It reuses the
 * existing Container primitive and the existing dark surface palette rather than
 * introducing a second design system.
 *
 * The section label carries the honesty requirement that applies to every page
 * inside it, so the caveat is present regardless of which view is open.
 */

const NAV = [
  { segment: '', label: 'Command Center' },
  { segment: 'markets', label: 'Cities' },
  { segment: 'services', label: 'Services' },
  { segment: 'engines', label: 'Engines' },
  { segment: 'opportunities', label: 'Opportunities' },
  { segment: 'recommendations', label: 'Recommendations' },
  { segment: 'competitors', label: 'Competitors' },
  { segment: 'citations', label: 'Citations' },
  { segment: 'responses', label: 'Responses' },
  { segment: 'experiments', label: 'Experiments' },
  { segment: 'quality', label: 'Technical SEO' },
  { segment: 'operations', label: 'Operations' },
]

export function AuthorityNav() {
  const params = useParams()
  const pathname = usePathname()
  const organizationId = params?.id as string | undefined

  if (!organizationId) return null

  const base = `/headquarters/${organizationId}/authority`

  return (
    <div className="border-b border-slate-800 bg-slate-950/60">
      <Container className="py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href={`/headquarters/${organizationId}`}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            ← Headquarters
          </Link>
          <span className="text-slate-700">|</span>
          <span className="text-xs uppercase tracking-wide text-sky-500">AI Authority</span>
        </div>

        <nav className="flex flex-wrap gap-1 mt-2.5">
          {NAV.map((item) => {
            const href = item.segment ? `${base}/${item.segment}` : base
            const active = item.segment
              ? pathname === href || pathname.startsWith(`${href}/`)
              : pathname === base

            return (
              <Link
                key={item.segment || 'overview'}
                href={href}
                className={`text-xs px-2.5 py-1.5 rounded transition-colors ${
                  active
                    ? 'bg-sky-950 text-sky-300 border border-sky-800'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </Container>
    </div>
  )
}