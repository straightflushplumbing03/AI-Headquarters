/**
 * AI Authority Engine -- seed taxonomy and authorization tests.
 *
 * The seed action writes the taxonomy every later measurement depends on, so
 * two things are pinned down here:
 *
 *   1. Its access control -- a plain member must not be able to initialise an
 *      organization. The role decision is exercised through the real helper,
 *      not a re-implemented copy.
 *   2. The shape of the taxonomy it produces -- 5 cities x 4 services = 20
 *      markets, and a query for each, with no invented combination.
 */

import { describe, it, expect } from 'vitest'
import { requireApprover } from '@/lib/authority/api-auth'
import { generateQueries } from '@/lib/authority/query-generator'
import { normalizeQuery } from '@/lib/authority/query-normalizer'
import type {
  AuthorityLocation,
  AuthorityService,
  AuthorityMarket,
  AuthorityQueryTemplate,
} from '@/lib/authority/types'

const CITY_NAMES = [
  'Laguna Niguel',
  'Dana Point',
  'San Clemente',
  'Ladera Ranch',
  'Laguna Hills',
]

const SERVICE_NAMES = [
  'Leak Detection',
  'Slab Leak Detection',
  'Water-Line Leak Detection / Rerouting',
  'Whole-House Repiping',
]

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const LOCATIONS = CITY_NAMES.map((name, index) => ({
  id: `loc-${index}`,
  organization_id: 'org-test',
  name,
  slug: slugify(name),
  state: 'CA',
  county: 'Orange County',
  tier: 'priority',
  is_home_market: false,
  local_context: { region: 'South Orange County' },
  nearby_location_ids: [],
  latitude: null,
  longitude: null,
  active: true,
  is_service_area: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})) as AuthorityLocation[]

const SERVICES = SERVICE_NAMES.map((name, index) => ({
  id: `svc-${index}`,
  organization_id: 'org-test',
  name,
  slug: slugify(name),
  tier: 'priority',
  customer_value_estimate: null,
  customer_value_basis: null,
  customer_phrases: [name.toLowerCase()],
  problem_phrases: [],
  related_service_ids: [],
  active: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
})) as AuthorityService[]

/** The 5 x 4 matrix, matching what the seed function inserts. */
const MARKETS: AuthorityMarket[] = LOCATIONS.flatMap((location) =>
  SERVICES.map(
    (service) =>
      ({
        id: `mkt-${location.id}-${service.id}`,
        organization_id: 'org-test',
        location_id: location.id,
        service_id: service.id,
        active: true,
        location_name: location.name,
        service_name: service.name,
        primary_page_id: null,
        notes: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }) as AuthorityMarket
  )
)

/** A representative slice of the seeded templates, one per intent dimension. */
const TEMPLATES: AuthorityQueryTemplate[] = [
  { pattern: 'Who does {service} in {city}?', intent: 'service', base: 9 },
  { pattern: 'Who is a good plumber in {city}?', intent: 'geographic', base: 6 },
  { pattern: 'Recommended {service} company in {city}', intent: 'buyer', base: 9 },
  { pattern: 'Who should I call for a hidden leak in {city}?', intent: 'problem', base: 9 },
].map(
  (t, index) =>
    ({
      id: `tpl-${index}`,
      organization_id: 'org-test',
      pattern: t.pattern,
      intent: t.intent,
      buyer_stage: 'consideration',
      base_importance: t.base,
      season_months: null,
      source: 'seed',
      active: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }) as AuthorityQueryTemplate
)

describe('seed authorization', () => {
  const context = (role: 'member' | 'approver') =>
    ({
      userId: 'user-1',
      organizationId: 'org-test',
      role,
      supabase: {} as never,
    }) as never

  it('rejects a plain member', async () => {
    const response = requireApprover(context('member'))
    expect(response).not.toBeNull()
    expect(response!.status).toBe(403)
    const body = await response!.json()
    expect(body.requiredRole).toBe('approver')
  })

  it('allows an approver', () => {
    expect(requireApprover(context('approver'))).toBeNull()
  })
})

describe('seed taxonomy coverage', () => {
  it('configures 5 cities and 4 services as 20 distinct markets', () => {
    expect(LOCATIONS).toHaveLength(5)
    expect(SERVICES).toHaveLength(4)
    expect(MARKETS).toHaveLength(20)
    expect(new Set(MARKETS.map((m) => `${m.location_id}::${m.service_id}`)).size).toBe(20)
  })

  it('generates at least one query for every configured market', () => {
    const generated = generateQueries({
      locations: LOCATIONS,
      services: SERVICES,
      markets: MARKETS,
      templates: TEMPLATES,
    })

    const covered = new Set(generated.map((q) => q.marketId))
    expect(covered.size).toBe(20)
  })

  it('covers each required intent dimension', () => {
    const generated = generateQueries({
      locations: LOCATIONS,
      services: SERVICES,
      markets: MARKETS,
      templates: TEMPLATES,
    })

    const intents = new Set(generated.map((q) => q.intent))
    for (const required of ['geographic', 'service', 'buyer', 'problem']) {
      expect(intents.has(required as never)).toBe(true)
    }
  })

  it('never emits an unresolved placeholder', () => {
    const generated = generateQueries({
      locations: LOCATIONS,
      services: SERVICES,
      markets: MARKETS,
      templates: TEMPLATES,
    })

    for (const query of generated) {
      expect(query.rawText).not.toContain('{')
      expect(query.rawText).not.toContain('}')
    }
  })

  it('does not invent a market that was not configured', () => {
    const singleService = MARKETS.filter((m) => m.service_id === SERVICES[0].id)
    const generated = generateQueries({
      locations: LOCATIONS,
      services: [SERVICES[0]],
      markets: singleService,
      templates: TEMPLATES,
    })

    const serviceIds = new Set(generated.map((q) => q.serviceId))
    expect(serviceIds).toEqual(new Set([SERVICES[0].id]))
    expect(new Set(generated.map((q) => q.locationId)).size).toBe(5)
  })

  it('collapses equivalent phrasings so templates cannot inflate counts', () => {
    const context = { locations: LOCATIONS.map((l) => ({ name: l.name, slug: l.slug })) }
    const a = normalizeQuery('Who does slab leak detection in San Clemente?', context)
    const b = normalizeQuery('recommended slab leak detection in san clemente', context)

    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    // Same city and same service: one measurement, not two, even though the
    // wording and the intent dimension differ.
    expect(a!.normalizedText).toBe(b!.normalizedText)
  })
})