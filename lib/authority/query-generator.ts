/**
 * AI Authority Engine -- query generation.
 *
 * Generates realistic CUSTOMER QUESTIONS rather than bare keywords, across the
 * intent dimensions the business cares about (geographic, service, buyer,
 * problem, comparison, emergency, cost). It composes templates with the real
 * city and service taxonomy and de-duplicates by normalized intent, so the
 * resulting monitoring set is both broad and non-redundant.
 *
 * Inputs beyond templates are optional and additive:
 *   - Search Console query text (when the integration is connected)
 *   - observed AI questions recorded from prior responses
 *   - competitor language observed in answers
 *   - seasonality, via template season_months
 *
 * Everything here is deterministic given the same inputs, which keeps query
 * generation reproducible and testable.
 */

import type {
  AuthorityLocation,
  AuthorityService,
  BuyerStage,
  GeneratedQuery,
  QueryIntent,
} from './types'
import { collapseNormalized, normalizeQuery, type NormalizationContext } from './query-normalizer'

export interface QueryTemplateRow {
  id: string
  pattern: string
  intent: QueryIntent
  buyer_stage: BuyerStage | null
  base_importance: number
  season_months: number[] | null
  source: string
  active: boolean
}

export interface MarketRow {
  id: string
  location_id: string
  service_id: string
  location_name: string
  service_name: string
}

export interface GenerationInput {
  locations: AuthorityLocation[]
  services: AuthorityService[]
  markets: MarketRow[]
  templates: QueryTemplateRow[]
  /** Observed Search Console query text, used to seed new templates later. */
  searchConsoleQueries?: string[]
  /** Month (1-12) used to apply seasonal weighting. Defaults to now. */
  month?: number
  /** Hard cap on generated queries, applied after importance sorting. */
  limit?: number
}

/** Priority service slugs map to the qualifier the normalizer expects. */
function servicePhrase(service: AuthorityService): string {
  const first = service.customer_phrases?.[0]
  if (first) return first
  return service.name.toLowerCase()
}

function problemPhrase(service: AuthorityService, index: number): string {
  const phrases = service.problem_phrases ?? []
  if (phrases.length === 0) return 'a hidden water leak'
  return phrases[index % phrases.length]
}

/** Importance is adjusted by season when a template declares a season window. */
function seasonalImportance(base: number, seasonMonths: number[] | null, month: number): number {
  if (!seasonMonths || seasonMonths.length === 0) return base
  const inSeason = seasonMonths.includes(month)
  const adjusted = inSeason ? base + 1 : base - 1
  return Math.min(10, Math.max(1, adjusted))
}

/**
 * Generate the monitoring query set for an organization's active markets.
 *
 * One query row is produced per (market, template) pair, then collapsed by
 * normalized intent so equivalent phrasings do not create duplicate queries.
 */
export function generateQueries(input: GenerationInput): GeneratedQuery[] {
  const { locations, services, markets, templates } = input
  const month = input.month ?? new Date().getUTCMonth() + 1

  const locationById = new Map(locations.map((l) => [l.id, l]))
  const serviceById = new Map(services.map((s) => [s.id, s]))

  const normalizationContext: NormalizationContext = {
    locations: locations.map((l) => ({ name: l.name, slug: l.slug })),
  }

  const activeTemplates = templates.filter((t) => t.active)
  if (activeTemplates.length === 0) return []

  type Draft = {
    rawText: string
    intent: QueryIntent
    buyerStage: BuyerStage | null
    importance: number
    templateId: string
    marketId: string
    locationId: string
    serviceId: string
  }

  const drafts: Draft[] = []

  for (const market of markets) {
    const location = locationById.get(market.location_id)
    const service = serviceById.get(market.service_id)
    if (!location || !service) continue

    for (const template of activeTemplates) {
      // Problem-intent templates cycle through the service's problem phrases so
      // one template yields several genuinely different customer questions.
      const problemVariants =
        template.pattern.includes('{problem}') && (service.problem_phrases?.length ?? 0) > 0
          ? service.problem_phrases.length
          : 1

      for (let i = 0; i < problemVariants; i++) {
        const rawText = template.pattern
          .replace(/\{city\}/g, location.name)
          .replace(/\{service\}/g, servicePhrase(service))
          .replace(/\{problem\}/g, problemPhrase(service, i))

        drafts.push({
          rawText,
          intent: template.intent,
          buyerStage: template.buyer_stage,
          importance: seasonalImportance(template.base_importance, template.season_months, month),
          templateId: template.id,
          marketId: market.id,
          locationId: location.id,
          serviceId: service.id,
        })
      }
    }
  }

  // Normalize, then collapse equivalent phrasings into one query per intent.
  const normalized = drafts
    .map((d) => {
      const n = normalizeQuery(d.rawText, normalizationContext, d.intent)
      return n ? { draft: d, n } : null
    })
    .filter((x): x is { draft: Draft; n: NonNullable<ReturnType<typeof normalizeQuery>> } => x !== null)

  const collapsed = collapseNormalized(normalized.map((x) => x.n))
  const keyToDraft = new Map<string, Draft>()
  for (const x of normalized) {
    const key = `${x.n.intent}|${x.n.normalizedText}`
    const existing = keyToDraft.get(key)
    // Keep the highest-importance draft as the representative phrasing.
    if (!existing || x.draft.importance > existing.importance) {
      keyToDraft.set(key, x.draft)
    }
  }

  const generated: GeneratedQuery[] = []
  for (const nq of collapsed) {
    const key = `${nq.intent}|${nq.normalizedText}`
    const draft = keyToDraft.get(key)
    if (!draft) continue
    generated.push({
      rawText: draft.rawText,
      normalizedText: nq.normalizedText,
      intent: nq.intent,
      buyerStage: draft.buyerStage,
      importance: draft.importance,
      templateId: draft.templateId,
      marketId: draft.marketId,
      locationId: draft.locationId,
      serviceId: draft.serviceId,
      source: 'generated',
    })
  }

  generated.sort((a, b) => b.importance - a.importance || a.normalizedText.localeCompare(b.normalizedText))

  if (input.limit && input.limit > 0) return generated.slice(0, input.limit)
  return generated
}

/**
 * Derive candidate templates from Search Console query text.
 *
 * Only returns patterns that differ from the existing template set, and only
 * when the query actually normalizes to a known market -- so a one-off oddity
 * in Search Console cannot seed a permanent monitoring query. Nothing is
 * persisted by this function; the caller decides.
 */
export function deriveTemplatesFromSearchConsole(
  queries: string[],
  existingPatterns: string[],
  context: NormalizationContext
): Array<{ pattern: string; intent: QueryIntent; source: 'search_console' }> {
  const existing = new Set(existingPatterns.map((p) => p.toLowerCase()))
  const out: Array<{ pattern: string; intent: QueryIntent; source: 'search_console' }> = []
  const seen = new Set<string>()

  for (const raw of queries) {
    const trimmed = (raw ?? '').trim()
    if (trimmed.length < 8 || trimmed.length > 160) continue
    const lower = trimmed.toLowerCase()
    if (existing.has(lower) || seen.has(lower)) continue

    const normalized = normalizeQuery(trimmed, context)
    if (!normalized) continue
    // Require a real location anchor; unanchored Search Console noise is not a
    // monitoring query for a city x service authority matrix.
    if (normalized.normalizedText.includes('no-location')) continue

    seen.add(lower)
    out.push({ pattern: trimmed, intent: normalized.intent, source: 'search_console' })
  }

  return out
}