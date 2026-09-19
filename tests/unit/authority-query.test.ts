/**
 * AI Authority Engine -- query normalization and generation tests.
 *
 * These tests exist to protect the metric integrity of the whole subsystem. If
 * normalization regresses, mention rates and trends silently become wrong while
 * still looking plausible, which is the worst possible failure mode for a
 * measurement product.
 */

import { describe, it, expect } from 'vitest'
import { normalizeQuery, runKeyFor } from '@/lib/authority/query-normalizer'
import { generateQueries } from '@/lib/authority/query-generator'
import type { AuthorityLocation, AuthorityService } from '@/lib/authority/types'

/**
 * Fixtures are built through helpers that must satisfy the real row types, so a
 * schema change fails compilation here instead of silently weakening the test.
 */
function location(overrides: Partial<AuthorityLocation> & { id: string; name: string; slug: string }): AuthorityLocation {
  return {
    organization_id: 'org-test',
    state: 'CA',
    county: 'Orange',
    tier: 'primary',
    active: true,
    is_service_area: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as AuthorityLocation
}

function service(overrides: Partial<AuthorityService> & { id: string; name: string; slug: string }): AuthorityService {
  return {
    organization_id: 'org-test',
    tier: 'primary',
    customer_value_estimate: null,
    customer_value_basis: null,
    customer_phrases: [overrides.name.toLowerCase()],
    problem_phrases: [],
    related_service_ids: [],
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as AuthorityService
}

const LOCATIONS = [
  { name: 'Laguna Niguel', slug: 'laguna-niguel' },
  { name: 'Dana Point', slug: 'dana-point' },
  { name: 'San Clemente', slug: 'san-clemente' },
  { name: 'Ladera Ranch', slug: 'ladera-ranch' },
  { name: 'Laguna Hills', slug: 'laguna-hills' },
]

const CONTEXT = { locations: LOCATIONS }

describe('query normalization', () => {
  it('collapses equivalent phrasings of the same intent to one key', () => {
    const variants = [
      'best leak detection company in San Clemente',
      'who should I call for leak detection in San Clemente',
      'recommended leak detector San Clemente',
      'who does leak detection in San Clemente?',
    ]

    const normalized = variants.map((v) => normalizeQuery(v, CONTEXT))
    const keys = new Set(normalized.map((n) => n?.normalizedText))

    // Every variant must resolve, and to a single shared key.
    expect(normalized.every((n) => n !== null)).toBe(true)
    expect(keys.size).toBe(1)
  })

  it('keeps every raw phrasing on the normalized result', () => {
    const raw = 'Who does slab leak detection in Dana Point?'
    const result = normalizeQuery(raw, CONTEXT)
    expect(result).not.toBeNull()
    // Raw variants are preserved so the Response Explorer can show exactly what
    // a human asked, even though metrics key off the normalized form.
    expect(result!.rawVariants).toContain(raw)
  })

  it('separates distinct locations', () => {
    const a = normalizeQuery('who does leak detection in San Clemente', CONTEXT)
    const b = normalizeQuery('who does leak detection in Dana Point', CONTEXT)
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a!.normalizedText).not.toBe(b!.normalizedText)
  })

  it('separates distinct services in the same city', () => {
    const leak = normalizeQuery('who does leak detection in San Clemente', CONTEXT)
    const repipe = normalizeQuery('who does whole house repiping in San Clemente', CONTEXT)
    expect(leak).not.toBeNull()
    expect(repipe).not.toBeNull()
    expect(leak!.normalizedText).not.toBe(repipe!.normalizedText)
  })

  it('preserves the emergency qualifier because it changes the customer need', () => {
    const plain = normalizeQuery('leak detection in Laguna Niguel', CONTEXT)
    const emergency = normalizeQuery('emergency leak detection in Laguna Niguel', CONTEXT)
    expect(plain).not.toBeNull()
    expect(emergency).not.toBeNull()
    expect(plain!.normalizedText).not.toBe(emergency!.normalizedText)
  })

  it('returns null rather than mis-bucketing an unattributable query', () => {
    // No service, no location, no recognizable problem: must not be forced into
    // a market, because doing so would corrupt that market's rates.
    const result = normalizeQuery('hello there', CONTEXT)
    expect(result).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(normalizeQuery('', CONTEXT)).toBeNull()
    expect(normalizeQuery('   ', CONTEXT)).toBeNull()
  })

  it('is deterministic', () => {
    const first = normalizeQuery('who does slab leak detection in Ladera Ranch', CONTEXT)
    const second = normalizeQuery('who does slab leak detection in Ladera Ranch', CONTEXT)
    expect(first!.normalizedText).toBe(second!.normalizedText)
  })
})

describe('run keys', () => {
  it('is stable within a day and differs across days', () => {
    const day1 = new Date('2026-03-01T08:00:00Z')
    const day1Later = new Date('2026-03-01T20:00:00Z')
    const day2 = new Date('2026-03-02T08:00:00Z')

    const a = runKeyFor('find:slab-leak:san-clemente', 'chatgpt', day1)
    const b = runKeyFor('find:slab-leak:san-clemente', 'chatgpt', day1Later)
    const c = runKeyFor('find:slab-leak:san-clemente', 'chatgpt', day2)

    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('distinguishes engines for the same query and day', () => {
    const at = new Date('2026-03-01T08:00:00Z')
    const gpt = runKeyFor('find:leak-detection:dana-point', 'chatgpt', at)
    const gemini = runKeyFor('find:leak-detection:dana-point', 'gemini', at)
    expect(gpt).not.toBe(gemini)
  })
})

describe('query generation', () => {
  const services = [
    service({ id: 'svc-leak', name: 'Leak Detection', slug: 'leak-detection' }),
    service({
      id: 'svc-slab',
      name: 'Slab Leak Detection',
      slug: 'slab-leak-detection',
      customer_phrases: ['slab leak detection', 'slab leak repair'],
    }),
    service({
      id: 'svc-water',
      name: 'Water-Line Leak Detection / Rerouting',
      slug: 'water-line',
      customer_phrases: ['water line leak detection'],
    }),
    service({
      id: 'svc-repipe',
      name: 'Whole-House Repiping',
      slug: 'whole-house-repiping',
      customer_phrases: ['whole house repiping', 'repipe'],
    }),
  ]

  const markets = [
    {
      id: 'm1',
      location_id: 'loc1',
      service_id: 'svc-leak',
      location_name: 'San Clemente',
      service_name: 'Leak Detection',
    },
    {
      id: 'm2',
      location_id: 'loc1',
      service_id: 'svc-slab',
      location_name: 'San Clemente',
      service_name: 'Slab Leak Detection',
    },
  ]

  const templates = [
    {
      id: 't1',
      pattern: 'who does {service} in {city}',
      intent: 'service' as const,
      buyer_stage: 'consideration' as const,
      base_importance: 9,
      season_months: null,
      source: 'seed',
      active: true,
    },
    {
      id: 't2',
      pattern: 'recommended {service} company in {city}',
      intent: 'buyer' as const,
      buyer_stage: 'decision' as const,
      base_importance: 8,
      season_months: null,
      source: 'seed',
      active: true,
    },
  ]

  const locations = [location({ id: 'loc1', name: 'San Clemente', slug: 'san-clemente' })]

  it('produces at least one query for every supplied market', () => {
    const generated = generateQueries({
      locations,
      services,
      markets,
      templates,
    })

    expect(generated.length).toBeGreaterThan(0)

    for (const market of markets) {
      const found = generated.some((g) => g.marketId === market.id)
      expect(found, `no query generated for market ${market.id}`).toBe(true)
    }
  })

  it('keeps distinct intents for the same market rather than collapsing them', () => {
    const generated = generateQueries({ locations, services, markets, templates })
    const forMarket = generated.filter((g) => g.marketId === 'm2')

    // t1 is a service-intent phrasing and t2 a buyer-intent phrasing: different
    // customer questions, so both must survive normalization.
    const intents = new Set(forMarket.map((g) => g.intent))
    expect(intents.has('service')).toBe(true)
    expect(intents.has('buyer')).toBe(true)
  })

  it('interpolates location and service into the pattern', () => {
    const generated = generateQueries({ locations, services, markets, templates })
    const forSlab = generated.find((g) => g.marketId === 'm2' && g.templateId === 't1')
    expect(forSlab).toBeDefined()
    expect(forSlab!.rawText).toContain('San Clemente')
    expect(forSlab!.rawText.toLowerCase()).toContain('slab leak')
  })

  it('never emits a query with an unresolved placeholder', () => {
    const generated = generateQueries({ locations, services, markets, templates })
    for (const query of generated) {
      expect(query.rawText).not.toContain('{')
      expect(query.rawText).not.toContain('}')
    }
  })

  it('skips templates containing a placeholder it cannot fill', () => {
    // A template using an unknown slot must not produce a query containing the
    // literal "{neighborhood}", because that would be monitored and billed as a
    // real question while meaning nothing.
    const generated = generateQueries({
      locations,
      services,
      markets,
      templates: [
        ...templates,
        {
          id: 't-unknown',
          pattern: 'best {service} in {neighborhood}',
          intent: 'service' as const,
          buyer_stage: null,
          base_importance: 5,
          season_months: null,
          source: 'seed',
          active: true,
        },
      ],
    })

    expect(generated.some((g) => g.templateId === 't-unknown')).toBe(false)
    expect(generated.every((g) => !g.rawText.includes('{'))).toBe(true)
  })

  it('emits a normalized text for every generated query', () => {
    const generated = generateQueries({ locations, services, markets, templates })
    for (const query of generated) {
      expect(query.normalizedText.length).toBeGreaterThan(0)
      expect(query.normalizedText).not.toContain('{')
    }
  })

  it('respects the limit option', () => {
    const generated = generateQueries({ locations, services, markets, templates, limit: 2 })
    expect(generated.length).toBeLessThanOrEqual(2)
  })

  it('returns nothing when there are no active templates', () => {
    const generated = generateQueries({
      locations,
      services,
      markets,
      templates: templates.map((t) => ({ ...t, active: false })),
    })
    expect(generated).toEqual([])
  })

  it('assigns importance within the documented range', () => {
    const generated = generateQueries({ locations, services, markets, templates })
    for (const query of generated) {
      expect(query.importance).toBeGreaterThanOrEqual(1)
      expect(query.importance).toBeLessThanOrEqual(10)
    }
  })
})