/**
 * AI Authority Engine -- query normalization.
 *
 * WHY THIS EXISTS:
 * "best leak detection company in San Clemente", "who should I call for leak
 * detection in San Clemente" and "recommended leak detector San Clemente" are
 * the same customer intent. Counting them as three separate observations would
 * inflate mention rates and make trends meaningless. Normalization collapses
 * them to one canonical intent string; the raw phrasings are still preserved on
 * the query rows so the Response Explorer can show exactly what was asked.
 *
 * The normalized form is `{intent}:{service}:{location}` plus a small set of
 * qualifiers, which is stable, human-readable, and indexable.
 */

import type { NormalizedQuery, QueryIntent } from './types'

/** Tokens that carry no intent and must not affect the normalized key. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will', 'shall',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'they', 'them',
  'in', 'on', 'at', 'of', 'for', 'to', 'from', 'with', 'by', 'near', 'around',
  'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'there', 'here', 'what', 'which', 'who', 'whom', 'whose', 'when', 'where',
  'why', 'how', 'any', 'some', 'get', 'got', 'need', 'want', 'looking',
  'please', 'help', 'call', 'hire', 'find', 'use', 'us', 'best', 'top', 'good',
  'great', 'recommended', 'recommend', 'reputable', 'trusted', 'experienced',
  'local', 'highly', 'rated', 'reliable', 'nearby', 'company', 'companies',
  'contractor', 'contractors', 'service', 'services', 'provider', 'providers',
  'plumber', 'plumbers', 'plumbing', 'business', 'businesses',
])

/**
 * Intent qualifiers worth preserving in the normalized key because they change
 * what the customer is actually asking for.
 */
const QUALIFIER_PATTERNS: Array<{ token: string; re: RegExp }> = [
  { token: 'emergency', re: /\bemergenc(y|ies)\b|\bsame[- ]day\b|\burgent\b|\bafter[- ]hours\b/i },
  { token: 'cost', re: /\bcost\b|\bprice\b|\bpricing\b|\bhow much\b|\bquote\b|\bestimate\b|\bcheap\b|\baffordable\b/i },
  { token: 'slab', re: /\bslab\b|\bunder[- ]slab\b|\bunder slab\b/i },
  { token: 'waterline', re: /\bwater[- ]?line\b|\bmain line\b|\bwater main\b/i },
  { token: 'reroute', re: /\brerout(e|ing)\b|\bre[- ]?rout(e|ing)\b|\breplace the line\b/i },
  { token: 'repipe', re: /\bre[- ]?pip(e|ing)\b|\bwhole[- ]house\b|\bwhole house\b|\bpex\b/i },
  { token: 'hidden', re: /\bhidden\b|\bunder[- ]?ground\b|\bunder ground\b|\bconcealed\b|\bbehind walls?\b/i },
  { token: 'detection', re: /\bdetect(ion|ing|or)?\b|\blocate\b|\bfind\b|\bdiagnos(e|is|tic)\b/i },
  { token: 'repair', re: /\brepair(s|ing)?\b|\bfix(es|ing)?\b|\bresolve\b/i },
  { token: 'replacement', re: /\breplace(ment)?\b|\bnew pipe\b|\brepipe\b/i },
  { token: 'comparison', re: /\bvs\b|\bversus\b|\bcompare\b|\bbetter than\b|\balternative/i },
]

/** Human-readable service labels keyed by the qualifier tokens they match. */
const SERVICE_RESOLUTION: Array<{ label: string; tokens: string[] }> = [
  { label: 'slab-leak-detection', tokens: ['slab'] },
  { label: 'water-line-rerouting', tokens: ['waterline', 'reroute'] },
  { label: 'whole-house-repiping', tokens: ['repipe'] },
  { label: 'leak-detection', tokens: ['detection', 'hidden'] },
]

/** Problem phrasing -> the canonical problem token. */
const PROBLEM_PATTERNS: Array<{ token: string; re: RegExp }> = [
  { token: 'high-water-bill', re: /\bhigh water bill\b|\bwater bill\b|\bbill went up\b/i },
  { token: 'low-pressure', re: /\blow water pressure\b|\bloss of pressure\b|\bwater pressure\b/i },
  { token: 'no-hot-water', re: /\bno hot water\b|\bhot water (disappear|gone|running out)\b|\bcold water\b/i },
  { token: 'wet-floor', re: /\bwet floor\b|\bwet spot\b|\bdamp (floor|carpet|wall)\b|\bmoisture\b/i },
  { token: 'water-damage', re: /\bwater damage\b|\bflood(ed|ing)?\b|\bstanding water\b/i },
  { token: 'sound-of-water', re: /\bsound of (running )?water\b|\bwater running\b|\bhissing\b|\bwater noise\b/i },
  { token: 'mold', re: /\bmold\b|\bmildew\b|\bmusty\b/i },
  { token: 'old-plumbing', re: /\bold (pipes|plumbing)\b|\bgalvanized\b|\bcopper line\b|\baging pipes\b/i },
  { token: 'cracked-pipe', re: /\bcracked pipe\b|\bbroken pipe\b|\bburst pipe\b|\bpipe leak\b/i },
]

export interface LocationMatch {
  name: string
  slug: string
}

export interface NormalizationContext {
  /** Known locations for the organization, longest names first. */
  locations: LocationMatch[]
}

/**
 * Normalize a raw query into a stable intent key.
 *
 * Returns `null` when the query carries no recognizable service, location, or
 * problem -- such a query cannot be attributed to a market, and silently
 * bucketing it as "other" would corrupt the per-market rates.
 */
export function normalizeQuery(
  raw: string,
  context: NormalizationContext,
  intentHint?: QueryIntent
): NormalizedQuery | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null

  const lower = trimmed.toLowerCase()
  const tokens = tokenize(lower)

  const qualifiers = QUALIFIER_PATTERNS.filter((q) => q.re.test(lower)).map((q) => q.token)
  const problems = PROBLEM_PATTERNS.filter((p) => p.re.test(lower)).map((p) => p.token)
  const location = findLocation(lower, context.locations)

  const service = resolveService(qualifiers, tokens)
  const intent = intentHint ?? inferIntent(qualifiers, problems, location, service)

  if (!service && !location && problems.length === 0) return null

  const parts = [
    intent,
    service ?? 'general-plumbing',
    location ? location.slug : 'no-location',
  ]
  if (problems.length > 0) parts.push(problems.join('+'))
  if (qualifiers.includes('emergency')) parts.push('emergency')
  if (qualifiers.includes('cost')) parts.push('cost')
  if (qualifiers.includes('comparison')) parts.push('comparison')
  if (qualifiers.includes('repair') && !qualifiers.includes('repipe')) parts.push('repair')

  return {
    normalizedText: parts.join(':'),
    intent,
    rawVariants: [trimmed],
  }
}

function tokenize(lower: string): string[] {
  return lower
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t))
}

/** Longest-name-first so "Laguna Hills" never matches inside "Laguna Niguel". */
function findLocation(lower: string, locations: LocationMatch[]): LocationMatch | null {
  const ordered = [...locations].sort((a, b) => b.name.length - a.name.length)
  for (const loc of ordered) {
    if (lower.includes(loc.name.toLowerCase())) return loc
  }
  return null
}

function resolveService(qualifiers: string[], _tokens: string[]): string | null {
  for (const resolution of SERVICE_RESOLUTION) {
    if (resolution.tokens.every((t) => qualifiers.includes(t))) return resolution.label
  }
  // Partial matches: repipe or water-line alone still identify the service.
  if (qualifiers.includes('repipe')) return 'whole-house-repiping'
  if (qualifiers.includes('waterline')) return 'water-line-leak-detection'
  if (qualifiers.includes('slab')) return 'slab-leak-detection'
  return null
}

function inferIntent(
  qualifiers: string[],
  problems: string[],
  location: LocationMatch | null,
  service: string | null
): QueryIntent {
  if (qualifiers.includes('emergency')) return 'emergency'
  if (qualifiers.includes('cost')) return 'cost'
  if (qualifiers.includes('comparison')) return 'comparison'
  if (problems.length > 0 && !service) return 'problem'
  if (problems.length > 0 && service) return 'problem'
  if (service) return 'service'
  if (location) return 'geographic'
  return 'service'
}

/**
 * Collapse a batch of normalized queries into unique intents, keeping every
 * raw phrasing that mapped to each one. Used by the generator to persist one
 * query row per intent rather than one per phrasing.
 */
export function collapseNormalized(queries: NormalizedQuery[]): NormalizedQuery[] {
  const byKey = new Map<string, NormalizedQuery>()
  for (const q of queries) {
    const key = `${q.intent}|${q.normalizedText}`
    const existing = byKey.get(key)
    if (existing) {
      if (!existing.rawVariants.includes(q.rawVariants[0])) {
        existing.rawVariants.push(q.rawVariants[0])
      }
    } else {
      byKey.set(key, { ...q, rawVariants: [...q.rawVariants] })
    }
  }
  return [...byKey.values()]
}

/** Stable identity for a normalized query, used for upserts and run keys. */
export function normalizedQueryKey(nq: NormalizedQuery): string {
  return `${nq.intent}::${nq.normalizedText}`
}

/**
 * Deterministic idempotency key for a monitored run.
 *
 * Including the UTC date means a re-run of the same query on the same engine
 * on the same day is deduplicated, while tomorrow's run is a new observation.
 * That is what makes daily monitoring idempotent without freezing history.
 */
export function runKeyFor(queryNormalizedText: string, engineKey: string, at: Date): string {
  const day = at.toISOString().slice(0, 10)
  const slug = queryNormalizedText.replace(/[^a-z0-9:-]+/gi, '-').slice(0, 120)
  return `${day}::${engineKey}::${slug}`
}