/**
 * AI Authority Engine -- anti-spam and content quality guardrails.
 *
 * This module exists to make the prohibited tactics DETECTABLE, not merely
 * discouraged in prose. Prohibited: fake reviews, fake citations, fake
 * backlinks, fake locations, fake offices, fake projects, fake awards, fake
 * certifications, fabricated customer stories, keyword stuffing, hidden text,
 * doorway pages, mass-generated low-quality city pages, competitor
 * impersonation, misleading structured data, and automated spam submissions.
 *
 * The guardrails are deliberately conservative and EXPLAINABLE: each returns
 * the specific finding, so a human reviewer sees why something was flagged
 * rather than an opaque score.
 */

/** Claims that require documentary support before they may be published. */
const PROHIBITED_CLAIM_PATTERNS: Array<{ id: string; re: RegExp; label: string }> = [
  { id: 'guaranteed_ranking', re: /\bguarantee(d|s)?\s+(a\s+)?(number\s*1|#1|first|top)\b/i, label: 'Guaranteed ranking claim' },
  { id: 'ranking_promise', re: /\b(we|will)\s+(rank|be)\s+(#\s*1|number one|first)\b/i, label: 'Ranking promise' },
  { id: 'guaranteed_results', re: /\bguarantee(d|s)?\s+results?\b/i, label: 'Guaranteed results claim' },
  { id: 'fake_certification', re: /\b(certified|accredited|licensed)\s+(by|through)\s+[A-Z][A-Za-z]+\b/i, label: 'Certification/affiliation claim (requires evidence)' },
  { id: 'award_claim', re: /\b(award[- ]winning|best\s+\w+\s+in\s+\w+\s+20\d\d|#\s*1\s+plumber)\b/i, label: 'Award/ranking claim (requires evidence)' },
  { id: 'fake_review_phrasing', re: /\b(customers? say we are the best|our 5[- ]star reputation speaks)\b/i, label: 'Unsupported testimonial phrasing' },
]

const SPAM_PATTERNS: Array<{ id: string; re: RegExp; label: string }> = [
  { id: 'hidden_text', re: /<\/?(?:div|span|p)[^>]*style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"']*["']/i, label: 'Hidden text technique' },
  { id: 'tiny_text', re: /font-size\s*:\s*(?:0|0?\.\d)px/i, label: 'Zero/near-zero font size' },
  { id: 'keyword_stuffing', re: /\b(\w{4,})(?:\s+\1\b){3,}/i, label: 'Repeated keyword phrase' },
  { id: 'doorway_signature', re: /\b(serving|we serve)\s+(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?){6,}/, label: 'Doorway-page city list signature' },
]

export interface GuardrailFinding {
  id: string
  label: string
  severity: 'info' | 'warning' | 'blocking'
  detail: string
}

export interface ContentQualityInput {
  text: string
  /** Human-readable city the content targets, if any. */
  targetLocation?: string | null
  /** Human-readable service the content targets, if any. */
  targetService?: string | null
  /** Evidence ids the draft claims to rely on. */
  citedEvidenceIds?: string[]
  /** How many evidence ids the caller verified actually exist and are publishable. */
  verifiedEvidenceIds?: string[]
  /** Canonical business name, to catch identity drift. */
  canonicalBusinessName?: string
}

export interface ContentQualityResult {
  pass: boolean
  findings: GuardrailFinding[]
  /** Blocking findings prevent publication outright. */
  blocking: GuardrailFinding[]
}

/**
 * Quality-control gate for any generated or human-authored content asset.
 *
 * `pass` is false when any blocking finding exists. Evidence support is a hard
 * gate: if the draft cites evidence that is not verified and publishable, the
 * draft is rejected regardless of how well written it is.
 */
export function checkContentQuality(input: ContentQualityInput): ContentQualityResult {
  const findings: GuardrailFinding[] = []
  const text = input.text ?? ''

  if (text.trim().length === 0) {
    findings.push({
      id: 'empty_content',
      label: 'Empty content',
      severity: 'blocking',
      detail: 'Content asset is empty.',
    })
    return { pass: false, findings, blocking: findings }
  }

  // --- Prohibited claims -------------------------------------------------
  for (const pattern of PROHIBITED_CLAIM_PATTERNS) {
    const match = text.match(pattern.re)
    if (match) {
      findings.push({
        id: pattern.id,
        label: pattern.label,
        severity: pattern.id === 'guaranteed_ranking' || pattern.id === 'ranking_promise' ? 'blocking' : 'warning',
        detail: `Matched "${truncate(match[0], 80)}". Requires documentary support before publication.`,
      })
    }
  }

  // --- Spam techniques ---------------------------------------------------
  for (const pattern of SPAM_PATTERNS) {
    const match = text.match(pattern.re)
    if (match) {
      const blocking = pattern.id !== 'doorway_signature'
      findings.push({
        id: pattern.id,
        label: pattern.label,
        severity: blocking ? 'blocking' : 'warning',
        detail: `Matched "${truncate(match[0], 80)}".`,
      })
    }
  }

  // --- Evidence support (hard gate) --------------------------------------
  const cited = input.citedEvidenceIds ?? []
  if (cited.length === 0) {
    findings.push({
      id: 'no_cited_evidence',
      label: 'No supporting evidence cited',
      severity: 'warning',
      detail:
        'Draft does not reference any evidence record. Content that makes specific ' +
        'local or service claims should cite verified first-party evidence.',
    })
  } else {
    const verified = new Set(input.verifiedEvidenceIds ?? [])
    const unsupported = cited.filter((id) => !verified.has(id))
    if (unsupported.length > 0) {
      findings.push({
        id: 'unsupported_evidence',
        label: 'Evidence cited is not verified/publishable',
        severity: 'blocking',
        detail: `Unsupported evidence id(s): ${unsupported.join(', ')}. Content may not be published on unverified evidence.`,
      })
    }
  }

  // --- Specificity / doorway risk ---------------------------------------
  const cityMentions = input.targetLocation
    ? countOccurrences(text.toLowerCase(), input.targetLocation.toLowerCase())
    : 0
  if (input.targetLocation && cityMentions === 0) {
    findings.push({
      id: 'missing_local_specificity',
      label: 'No local specificity',
      severity: 'warning',
      detail: `Targets ${input.targetLocation} but never names it. A city page without genuine local content is a doorway-page risk.`,
    })
  }

  if (cityMentions > 6) {
    findings.push({
      id: 'excessive_city_repetition',
      label: 'Excessive city name repetition',
      severity: 'warning',
      detail: `"${input.targetLocation}" appears ${cityMentions} times. Review for unnatural keyword repetition.`,
    })
  }

  const wordCount = countWords(text)
  if (wordCount < 150) {
    findings.push({
      id: 'thin_content',
      label: 'Thin content',
      severity: 'warning',
      detail: `Only ${wordCount} words. Thin pages add little authority and risk looking like doorway pages.`,
    })
  }

  // --- Business identity accuracy ---------------------------------------
  const canonicalName = input.canonicalBusinessName
  if (canonicalName && text.trim().length > 0) {
    const identityVariants = extractBusinessMentions(text)
    const canonicalKey = normalizeName(canonicalName)
    const nonCanonical = identityVariants.filter((v) => normalizeName(v) !== canonicalKey)
    if (nonCanonical.length > 0) {
      findings.push({
        id: 'business_identity_drift',
        label: 'Inconsistent business name',
        severity: 'warning',
        detail:
          `Content uses non-canonical business name form(s): ${[...new Set(nonCanonical)].slice(0, 3).join('; ')}. ` +
          `Canonical: "${canonicalName}".`,
      })
    }
  }

  // --- Duplicate-content heuristic --------------------------------------
  if (hasRepeatedSentences(text)) {
    findings.push({
      id: 'duplicate_sentences',
      label: 'Repeated sentences',
      severity: 'blocking',
      detail: 'The same sentence appears multiple times, indicating generated filler rather than content.',
    })
  }

  const blocking = findings.filter((f) => f.severity === 'blocking')
  return { pass: blocking.length === 0, findings, blocking }
}

/** Detect interchangeable city pages by comparing their templates. */
export function detectDoorwaySimilarity(
  pages: Array<{ locationName: string; text: string }>
): Array<{ a: string; b: string; similarity: number }> {
  const results: Array<{ a: string; b: string; similarity: number }> = []

  const fingerprint = (text: string, locationName: string) =>
    tokenize(
      text
        .toLowerCase()
        .split(locationName.toLowerCase())
        .join(' {city} ')
    )

  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const a = fingerprint(pages[i].text, pages[i].locationName)
      const b = fingerprint(pages[j].text, pages[j].locationName)
      const similarity = jaccard(a, b)
      if (similarity >= 0.85) {
        results.push({ a: pages[i].locationName, b: pages[j].locationName, similarity: round2(similarity) })
      }
    }
  }

  return results
}

/**
 * Validate that a proposed structured-data claim is actually supported by
 * visible content. Misleading schema is prohibited, so a claim that is not
 * present in the rendered text is rejected.
 */
export function validateStructuredDataSupport(params: {
  schemaType: string
  claimedValues: string[]
  visibleText: string
}): { supported: boolean; unsupported: string[] } {
  const visible = params.visibleText.toLowerCase()
  const unsupported = params.claimedValues.filter(
    (value) => value.trim().length > 0 && !visible.includes(value.trim().toLowerCase())
  )
  return { supported: unsupported.length === 0, unsupported }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .replace(/[^a-z0-9\s{}/]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 3)
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  return haystack.split(needle).length - 1
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length
}

function extractBusinessMentions(text: string): string[] {
  const matches = text.match(
    /\b[A-Z][A-Za-z0-9&'’.\-]*(?:\s+[A-Z][A-Za-z0-9&'’.\-]*)*(?:\s+(?:Plumbing|Plumbers|Leak|Detection|Rooter|Drain|Repipe)\b[A-Za-z\s&]*)/g
  )
  return matches ?? []
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '')
}

function hasRepeatedSentences(text: string): boolean {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.split(/\s+/).length >= 8)

  const seen = new Map<string, number>()
  for (const sentence of sentences) {
    const count = (seen.get(sentence) ?? 0) + 1
    seen.set(sentence, count)
    if (count >= 3) return true
  }
  return false
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}