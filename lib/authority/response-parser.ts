/**
 * AI Authority Engine -- AI response parser.
 *
 * Turns a verbatim AI answer into structured observations: which businesses
 * were named, in what order, which were explicitly recommended, which were
 * cited, from which domains, and in what location/service context.
 *
 * DESIGN PRINCIPLES
 *
 * 1. DETERMINISTIC AND EXPLAINABLE. No model is used to parse. A parse can be
 *    re-run and produce the identical result, which is what makes the metrics
 *    auditable. `parserVersion` is stored on every response so history can be
 *    re-parsed after an improvement without silently rewriting the past.
 *
 * 2. CONSERVATIVE. Ambiguity lowers confidence and is recorded in `notes`
 *    rather than being resolved by guessing. A business we are unsure about is
 *    still recorded (it is real evidence that a name appeared) but flagged.
 *
 * 3. NEVER FABRICATES. Absent data stays absent: `subjectPosition` is null when
 *    the subject was not found, and `subjectCited` is only true when a citation
 *    URL actually resolves to the subject's domain.
 */

import {
  AUTHORITY_PARSER_VERSION,
  type ParsedBusiness,
  type ParsedCitation,
  type ParsedFactualClaim,
  type ParsedResponse,
  type SourceType,
} from './types'

export interface ParserContext {
  /** Canonical subject business name, e.g. 'Straight Flush Plumbing & Leak Detection'. */
  subjectName: string
  /** Every domain that counts as first-party for the subject. */
  subjectDomains: string[]
  /** Known city names for this organization. */
  knownLocations: string[]
  /** Known service names/phrases for this organization. */
  knownServices: string[]
  /** Competitor names already known, to improve matching. */
  knownCompetitors?: string[]
}

export interface ParserInput {
  text: string
  citations: Array<{ url: string; title?: string; domain: string }>
  /** The query that produced this answer (helps with context detection). */
  query: string
  /** Market context, used as a fallback when the answer does not name a city. */
  declaredLocation?: string | null
  declaredService?: string | null
}

/**
 * Language that indicates a genuine recommendation rather than a passing
 * mention. Kept deliberately small and literal: broad patterns would flag
 * every sentence as a recommendation and destroy the metric's meaning.
 */
const RECOMMENDATION_MARKERS = [
  'i recommend',
  'we recommend',
  'i would recommend',
  'we would recommend',
  'would recommend',
  'would suggest',
  'i suggest',
  'highly recommend',
  'strongly recommend',
  'recommended',
  'you should call',
  'you could call',
  'best choice',
  'best option',
  'excellent choice',
  'top choice',
  'top pick',
  'one of the best',
  'among the best',
  'go with',
  'consider calling',
  'worth calling',
  'trusted',
  'reputable',
  'well-regarded',
  'standout',
  'stand out',
  'leader in',
  'specializes in',
  'specialises in',
  'well known for',
]

/**
 * Negation guards.
 *
 * "I would not recommend this company" contains the substring "would
 * recommend". Without this guard a negative review of the subject would be
 * counted as a recommendation, which inverts the metric it feeds. The guard is
 * intentionally narrow: it only suppresses a marker when a negation cue appears
 * immediately before it, so an unrelated "no" elsewhere in the sentence cannot
 * hide a genuine recommendation.
 */
const NEGATION_CUE = /(?:not|never|no longer|cannot|can't|don't|do not|wouldn't|would not|avoid|steer clear of)\s+(?:\w+\s+){0,2}$/

/** True when the line contains explicit recommendation language. */
export function isRecommendedLine(line: string): boolean {
  const lower = line.toLowerCase()
  return RECOMMENDATION_MARKERS.some((marker) => {
    let from = 0
    for (;;) {
      const index = lower.indexOf(marker, from)
      if (index === -1) return false
      if (!NEGATION_CUE.test(lower.slice(0, index))) return true
      from = index + 1
    }
  })
}

/**
 * Legal-entity suffixes and generic words that must not be required in a match
 * but should not prevent one either. Normalization strips punctuation and
 * common filler so "Straight Flush Plumbing & Leak Detection" matches
 * "Straight Flush Plumbing and Leak Detection".
 */
const NAME_NOISE = /\b(inc|llc|l\.l\.c|corp|corporation|company|co|the|and)\b/g

/** Credential-ish claims that must never be taken at face value. */
const CREDENTIAL_PATTERN = /\b(licensed|license|bonded|insured|insured|certified|certification|award-winning|award winning|#1|number one|best in)\b/i
const PRICING_PATTERN = /\$\s?\d|\bprice(s|d)?\b|\bcost(s)?\b|\bflat rate\b|\bfree estimate\b/i
const AVAILABILITY_PATTERN = /\b(24\/7|same[- ]day|emergency service|available today|response time|within \d+ (hours|minutes))\b/i

export function parseResponse(input: ParserInput, context: ParserContext): ParsedResponse {
  const notes: string[] = []
  const text = input.text ?? ''

  if (!text.trim()) {
    return emptyParse(notes.concat('empty response text'))
  }

  const lines = splitIntoUnits(text)
  const subjectKeys = buildNameKeys(context.subjectName)
  const competitorKeys = (context.knownCompetitors ?? []).flatMap(buildNameKeys)

  const businesses = extractBusinesses(lines, {
    subjectKeys,
    competitorKeys,
    knownServices: context.knownServices,
    knownLocations: context.knownLocations,
    notes,
  })

  const citations = extractCitations(input.citations ?? [], notes)
  const recommendationLanguage = findRecommendationLanguage(lines)

  const subject = businesses.find((b) => b.isSubject) ?? null
  const subjectCited = isSubjectCited(citations, context.subjectDomains)

  const locationContext = detectLocationContext(text, input.declaredLocation, context.knownLocations)
  const serviceContext = detectServiceContext(text, input.declaredService, context.knownServices)

  const factualClaims = extractClaims(lines)

  const confidence = scoreConfidence(businesses, notes, text)

  if (businesses.length === 0) {
    notes.push('no businesses detected in response')
  }

  return {
    parserVersion: AUTHORITY_PARSER_VERSION,
    businesses,
    citations,
    locationContext,
    serviceContext,
    subjectMentioned: !!subject,
    subjectPosition: subject?.position ?? null,
    subjectCited,
    subjectRecommended: !!subject?.isRecommended,
    recommendationLanguage,
    factualClaims,
    confidence,
    notes,
  }
}

function emptyParse(notes: string[]): ParsedResponse {
  return {
    parserVersion: AUTHORITY_PARSER_VERSION,
    businesses: [],
    citations: [],
    locationContext: null,
    serviceContext: null,
    subjectMentioned: false,
    subjectPosition: null,
    subjectCited: false,
    subjectRecommended: false,
    recommendationLanguage: [],
    factualClaims: [],
    confidence: 0,
    notes,
  }
}

/**
 * Split an answer into candidate units, preserving order.
 *
 * Handles both prose and the very common numbered/bulleted list format, which
 * is where the ordering signal actually lives.
 */
export function splitIntoUnits(text: string): string[] {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const units: string[] = []
  for (const line of rawLines) {
    // Strip list markers so "1. Foo Plumbing" and "* Foo Plumbing" compare equal.
    const cleaned = line.replace(/^\s*(?:[-*\u2022]|\d{1,2}[.)])\s*/, '').trim()
    if (cleaned.length === 0) continue
    units.push(cleaned)
  }
  return units
}

/** Normalize a business name into a comparable key. */
export function normalizeBusinessName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(NAME_NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Distinctive match keys for a name: the full normalized name and its head. */
function buildNameKeys(name: string): string[] {
  const normalized = normalizeBusinessName(name)
  if (!normalized) return []
  const keys = new Set<string>([normalized])
  const words = normalized.split(' ').filter((w) => w.length > 2)
  // A 2-3 word head is distinctive enough to match a shortened mention
  // ("Straight Flush Plumbing") without matching a generic word alone.
  if (words.length >= 2) keys.add(words.slice(0, 3).join(' '))
  if (words.length >= 2) keys.add(words.slice(0, 2).join(' '))
  return [...keys].filter((k) => k.split(' ').length >= 2 || k.length >= 8)
}

/**
 * Extract candidate business names.
 *
 * Two complementary strategies, because AI answers present businesses in two
 * shapes:
 *   a. LIST SHAPE -- a line that leads with the business name ("1. Acme Plumbing
 *      -- specializes in slab leaks"). High precision.
 *   b. INLINE SHAPE -- a name followed by recommendation language inside a
 *      paragraph. Lower precision, so it requires a supported name-like
 *      structure before we accept it.
 */
function extractBusinesses(
  lines: string[],
  ctx: {
    subjectKeys: string[]
    competitorKeys: string[]
    knownServices: string[]
    knownLocations: string[]
    notes: string[]
  }
): ParsedBusiness[] {
  const found = new Map<string, ParsedBusiness>()
  let position = 0

  for (const line of lines) {
    // --- Strategy (a): leading name in a list-style line.
    const leadMatch = line.match(/^([A-Z][A-Za-z0-9&'’.\- ]{2,60}?)(?:\s*[:\u2013\u2014-]\s*|\s+-\s+|\s*\(|\s*$)/)
    const candidates: string[] = []
    if (leadMatch) {
      const candidate = cleanBusinessName(leadMatch[1])
      if (isNameLike(candidate)) candidates.push(candidate)
    }

    // --- Strategy (b): known names appearing anywhere in the line.
    const inlineHits = findKnownNamesInLine(line, ctx.subjectKeys, ctx.competitorKeys)
    const minLengthForInline = 12
    for (const hit of inlineHits) {
      if (hit.raw.length >= minLengthForInline) candidates.push(hit.raw)
    }

    for (const candidate of candidates) {
      const normalized = normalizeBusinessName(candidate)
      if (!normalized) continue
      if (found.has(normalized)) {
        // Same business mentioned twice: keep the first position, but merge the
        // richer context if the later mention has more.
        const existing = found.get(normalized)!
        existing.isRecommended = existing.isRecommended || isRecommendedLine(line)
        if (!existing.recommendationContext && isRecommendedLine(line)) {
          existing.recommendationContext = excerpt(line)
        }
        continue
      }

      position += 1
      const isSubject =
        ctx.subjectKeys.some((key) => normalized.includes(key) || key.includes(normalized)) ||
        ctx.subjectKeys.some((key) => sharesDistinctiveToken(key, normalized))

      found.set(normalized, {
        name: candidate,
        normalizedName: normalized,
        position,
        website: null,
        services: matchKnownTerms(line, ctx.knownServices),
        locations: matchKnownTerms(line, ctx.knownLocations),
        isRecommended: isRecommendedLine(line),
        recommendationContext: isRecommendedLine(line) ? excerpt(line) : null,
        isSubject,
      })
    }
  }

  // Websites are frequently listed in a parenthetical or after a dash.
  for (const business of found.values()) {
    business.website = findWebsiteNear(lines, business.name)
  }

  return [...found.values()].sort((a, b) => a.position - b.position)
}

/** Strip trailing punctuation and leading articles from a candidate name. */
function cleanBusinessName(raw: string): string {
  return raw
    .replace(/^[\s\-*\u2022]+/, '')
    .replace(/[.,;:]+$/, '')
    .replace(/^(the|a|an)\s+/i, '')
    .trim()
}

/**
 * A candidate must look like a company, not a sentence fragment.
 * Requires 1-5 words, at least one capitalized word, and a business-ish token.
 */
function isNameLike(candidate: string): boolean {
  if (!candidate) return false
  const words = candidate.split(/\s+/)
  if (words.length < 1 || words.length > 6) return false
  if (candidate.length < 4 || candidate.length > 70) return false
  if (!/^[A-Z0-9]/.test(candidate)) return false
  // Reject bare sentences: a name rarely ends in a common verb/preposition.
  if (/\b(is|are|was|were|has|have|will|can|should|that|which|because|offers|provides)\b$/i.test(candidate)) {
    return false
  }
  // Business-like signal: a proper-noun-ish token or a trade keyword.
  const businessSignal =
    /\b(plumb\w*|leak|rooter|drain|pipe|sewer|water|heating|air|hvac|service|services|company|contractors?|specialists?|solutions|group|inc|llc|corp)\b/i
  const capitalizedWords = words.filter((w) => /^[A-Z]/.test(w)).length
  return businessSignal.test(candidate) || capitalizedWords >= 2
}

/** Find already-known names inside a line (order preserved by earliest index). */
function findKnownNamesInLine(
  line: string,
  subjectKeys: string[],
  competitorKeys: string[]
): Array<{ raw: string; index: number }> {
  const normalizedLine = normalizeBusinessName(line)
  const hits: Array<{ raw: string; index: number }> = []

  for (const key of [...subjectKeys, ...competitorKeys]) {
    const idx = normalizedLine.indexOf(key)
    if (idx === -1) continue
    // Recover a display name from the ORIGINAL line by locating the words.
    const raw = recoverDisplayName(line, key)
    if (raw) hits.push({ raw, index: idx })
  }

  return hits.sort((a, b) => a.index - b.index)
}

/**
 * Recover the capitalized form of a known name from the original text, so the
 * stored name is what the AI actually wrote rather than our normalized key.
 */
function recoverDisplayName(originalLine: string, normalizedKey: string): string | null {
  const words = normalizedKey.split(' ').filter(Boolean)
  if (words.length === 0) return null
  const pattern = new RegExp(
    words.map((w) => escapeRegExp(w)).join("[\\s,&'.\\-]+"),
    'i'
  )
  const match = originalLine.match(pattern)
  if (!match) return null
  return cleanBusinessName(match[0])
}

/** Require a majority of the longer name's distinctive tokens to overlap. */
function sharesDistinctiveToken(a: string, b: string): boolean {
  const tokensA = a.split(' ').filter((t) => t.length > 3)
  const tokensB = new Set(b.split(' ').filter((t) => t.length > 3))
  if (tokensA.length < 2) return false
  const overlap = tokensA.filter((t) => tokensB.has(t)).length
  return overlap >= 2 && overlap / tokensA.length >= 0.6
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findRecommendationLanguage(lines: string[]): string[] {
  const hits = new Set<string>()
  for (const line of lines) {
    const lower = line.toLowerCase()
    for (const marker of RECOMMENDATION_MARKERS) {
      // A presently-negated marker is not recommendation language.
      const index = lower.indexOf(marker)
      if (index === -1) continue
      if (NEGATION_CUE.test(lower.slice(0, index))) continue
      hits.add(marker)
    }
  }
  return [...hits]
}

function matchKnownTerms(line: string, terms: string[]): string[] {
  const lower = line.toLowerCase()
  const out: string[] = []
  for (const term of terms) {
    const t = (term ?? '').trim().toLowerCase()
    if (t.length < 4) continue
    if (lower.includes(t)) out.push(term)
  }
  return [...new Set(out)]
}

/** Look for a URL on the line that names the business, else the nearest line. */
function findWebsiteNear(lines: string[], businessName: string): string | null {
  const normalized = normalizeBusinessName(businessName)
  const head = normalized.split(' ').slice(0, 2).join(' ')

  for (const line of lines) {
    const urls = line.match(/https?:\/\/[^\s)]+/g)
    if (!urls) continue
    const lineNormalized = normalizeBusinessName(line)
    if (head.length > 4 && lineNormalized.includes(head)) {
      return urls[0]
    }
  }
  return null
}

function extractCitations(
  citations: Array<{ url: string; title?: string; domain: string }>,
  notes: string[]
): ParsedCitation[] {
  const out: ParsedCitation[] = []
  const seen = new Set<string>()
  let position = 0

  for (const citation of citations) {
    const url = (citation.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) {
      if (url) notes.push(`ignored non-http citation: ${truncate(url, 60)}`)
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    position += 1
    out.push({
      url,
      domain: citation.domain || domainOf(url),
      title: citation.title ?? null,
      businessName: null,
      position,
    })
  }

  return out
}

/** True only when a cited URL's host is one of the subject's own domains. */
export function isSubjectCited(citations: ParsedCitation[], subjectDomains: string[]): boolean {
  if (citations.length === 0) return false
  const domains = new Set(
    subjectDomains
      .map((d) => d.trim().toLowerCase().replace(/^www\./, ''))
      .filter(Boolean)
  )
  if (domains.size === 0) return false
  return citations.some((c) => domains.has(c.domain))
}

function detectLocationContext(
  text: string,
  declared: string | null | undefined,
  knownLocations: string[]
): string | null {
  const lower = text.toLowerCase()
  const matched = knownLocations.filter((l) => lower.includes(l.toLowerCase()))
  if (matched.length > 0) {
    // Prefer the most frequently named location as the answer's focus.
    const counts = matched.map((l) => ({
      l,
      n: lower.split(l.toLowerCase()).length - 1,
    }))
    counts.sort((a, b) => b.n - a.n || b.l.length - a.l.length)
    return counts[0].l
  }
  return declared ?? null
}

function detectServiceContext(
  text: string,
  declared: string | null | undefined,
  knownServices: string[]
): string | null {
  const matched = matchKnownTerms(text, knownServices)
  if (matched.length > 0) return matched[0]
  return declared ?? null
}

/**
 * Record claims that would be risky to repeat without verification. These are
 * stored as claims, never promoted to facts.
 */
function extractClaims(lines: string[]): ParsedFactualClaim[] {
  const claims: ParsedFactualClaim[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const sentences = line.split(/(?<=[.!?])\s+/)
    for (const sentence of sentences) {
      const trimmed = sentence.trim()
      if (trimmed.length < 10 || trimmed.length > 400) continue

      let kind: ParsedFactualClaim['kind'] | null = null
      if (CREDENTIAL_PATTERN.test(trimmed)) kind = 'credential'
      else if (PRICING_PATTERN.test(trimmed)) kind = 'pricing'
      else if (AVAILABILITY_PATTERN.test(trimmed)) kind = 'availability'

      if (!kind) continue
      if (seen.has(trimmed)) continue
      seen.add(trimmed)
      claims.push({ text: trimmed, kind })
      if (claims.length >= 25) return claims
    }
  }

  return claims
}

/**
 * Confidence reflects how sure we are that the PARSE is a faithful reading of
 * the answer, not how favourable the answer was. Sparse or list-formatted
 * answers parse reliably; long unstructured prose does not.
 */
function scoreConfidence(businesses: ParsedBusiness[], notes: string[], text: string): number {
  let score = 50

  if (businesses.length > 0) score += 25
  if (businesses.length > 3) score += 5
  if (businesses.some((b) => b.isSubject)) score += 5
  if (businesses.some((b) => b.isRecommended)) score += 5
  if (businesses.some((b) => b.locations.length > 0)) score += 5

  const listLike = businesses.length > 0 && businesses.length <= 15
  if (listLike) score += 5

  // Very long free-form answers introduce more ambiguity.
  if (text.length > 6000) score -= 10
  score -= Math.min(notes.length * 3, 15)

  return Math.max(0, Math.min(100, score))
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function excerpt(line: string): string {
  return truncate(line.trim(), 240)
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`
}

// ---------------------------------------------------------------------------
// Source classification
// ---------------------------------------------------------------------------

/** Well-known domains classified by hand, because guessing gets this wrong. */
const KNOWN_SOURCE_DOMAINS: Record<string, SourceType> = {
  'google.com': 'google_business_profile',
  'maps.google.com': 'google_business_profile',
  'yelp.com': 'review_platform',
  'angi.com': 'review_platform',
  'angieslist.com': 'review_platform',
  'homeadvisor.com': 'review_platform',
  'bbb.org': 'review_platform',
  'trustpilot.com': 'review_platform',
  'nextdoor.com': 'community_site',
  'yellowpages.com': 'directory',
  'mapquest.com': 'directory',
  'manta.com': 'directory',
  'thumbtack.com': 'directory',
  'houzz.com': 'directory',
  'porch.com': 'directory',
  'buildzoom.com': 'directory',
  'facebook.com': 'social',
  'instagram.com': 'social',
  'linkedin.com': 'social',
  'twitter.com': 'social',
  'x.com': 'social',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'reddit.com': 'community_site',
  'patch.com': 'local_publication',
  'ocregister.com': 'news',
  'latimes.com': 'news',
  'ocgov.com': 'government',
  'ca.gov': 'government',
  'csloa.org': 'government',
}

/** Local-paper and association hints for unknown domains. */
const SOURCE_TYPE_HINTS: Array<{ re: RegExp; type: SourceType }> = [
  { re: /\b(news|times|tribune|gazette|journal|herald|press)\b/, type: 'news' },
  { re: /\b(patch|city|town|community|neighborhood|village)\b/, type: 'local_publication' },
  { re: /\b(chamber|association|guild|coalition|alliance)\b/, type: 'business_association' },
  { re: /\b(plumb|hvac|trade|contractor)\b/, type: 'trade_organization' },
  { re: /\b(review|rating|rated|trust)\b/, type: 'review_platform' },
  { re: /\b(directory|listing|find|local|near)\b/, type: 'directory' },
]

/**
 * Classify a citing domain.
 *
 * `subjectDomains` and `competitorDomains` are checked first: a company's own
 * site is first-party regardless of how generic its name looks.
 */
export function classifySourceDomain(
  domain: string,
  subjectDomains: string[] = [],
  competitorDomains: string[] = []
): { sourceType: SourceType; isFirstParty: boolean } {
  const clean = (domain ?? '').trim().toLowerCase().replace(/^www\./, '')
  if (!clean) return { sourceType: 'other', isFirstParty: false }

  const matches = (candidate: string) => clean === candidate || clean.endsWith(`.${candidate}`)

  if (subjectDomains.some((d) => matches(d.toLowerCase().replace(/^www\./, '')))) {
    return { sourceType: 'company_website', isFirstParty: true }
  }
  if (competitorDomains.some((d) => matches(d.toLowerCase().replace(/^www\./, '')))) {
    return { sourceType: 'competitor_website', isFirstParty: false }
  }

  for (const [known, type] of Object.entries(KNOWN_SOURCE_DOMAINS)) {
    if (matches(known)) return { sourceType: type, isFirstParty: false }
  }

  for (const hint of SOURCE_TYPE_HINTS) {
    if (hint.re.test(clean)) return { sourceType: hint.type, isFirstParty: false }
  }

  return { sourceType: 'other', isFirstParty: false }
}