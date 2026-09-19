/**
 * AI Authority Engine -- data quality checks.
 *
 * Monitoring data degrades in predictable ways: the same business extracted
 * twice under slightly different names, the same URL cited with and without a
 * trailing slash, duplicate queries that escaped normalization, URLs that are
 * not URLs. Left alone, these inflate or deflate every metric downstream.
 *
 * This module DETECTS and REPORTS. It never deletes or merges anything
 * automatically: a wrong auto-merge silently rewrites history, which is worse
 * than a visible duplicate. Findings are surfaced as alerts and audit entries
 * for a human to resolve.
 */

export type DataQualityIssueType =
  | 'duplicate_competitor'
  | 'duplicate_query'
  | 'duplicate_citation'
  | 'malformed_url'
  | 'missing_location'
  | 'missing_service'
  | 'inconsistent_business_name'
  | 'orphan_record'
  | 'invalid_foreign_key'

export interface DataQualityIssue {
  issueType: DataQualityIssueType
  severity: 'low' | 'medium' | 'high'
  detail: string
  affectedIds: string[]
  recommendation: string
}

/** Competitor names that differ only by punctuation or legal suffix. */
export function findDuplicateCompetitors(
  competitors: Array<{ id: string; name: string; normalized_name: string; website: string | null }>
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = []

  // Same website, different names: almost certainly one company.
  const byWebsite = new Map<string, Array<{ id: string; name: string }>>()
  for (const competitor of competitors) {
    const site = normalizeSite(competitor.website)
    if (!site) continue
    byWebsite.set(site, [...(byWebsite.get(site) ?? []), { id: competitor.id, name: competitor.name }])
  }
  for (const [site, group] of byWebsite) {
    if (group.length < 2) continue
    issues.push({
      issueType: 'duplicate_competitor',
      severity: 'medium',
      detail: `${group.length} competitors share the website ${site}: ${group.map((g) => g.name).join(', ')}`,
      affectedIds: group.map((g) => g.id),
      recommendation: 'Merge the duplicates after confirming they are the same business.',
    })
  }

  // Names that collapse to the same key once punctuation is stripped.
  const byLooseName = new Map<string, Array<{ id: string; name: string }>>()
  for (const competitor of competitors) {
    const loose = competitor.normalized_name.replace(/[^a-z0-9]/g, '')
    if (loose.length < 5) continue
    byLooseName.set(loose, [...(byLooseName.get(loose) ?? []), { id: competitor.id, name: competitor.name }])
  }
  for (const [loose, group] of byLooseName) {
    if (group.length < 2) continue
    if (new Set(group.map((g) => g.id)).size < 2) continue
    issues.push({
      issueType: 'duplicate_competitor',
      severity: 'low',
      detail: `Competitor names differ only by punctuation: ${group.map((g) => g.name).join(' / ')}`,
      affectedIds: group.map((g) => g.id),
      recommendation: 'Confirm these are the same business and merge if so.',
    })
    void loose
  }

  return issues
}

/** Queries with the same normalized intent but different raw text (expected), or the same normalized key twice (not expected). */
export function findDuplicateQueries(
  queries: Array<{ id: string; normalized_text: string; intent: string; raw_text: string }>
): DataQualityIssue[] {
  const seen = new Map<string, Array<{ id: string; raw: string }>>()

  for (const query of queries) {
    const key = `${query.intent}::${query.normalized_text}`
    seen.set(key, [...(seen.get(key) ?? []), { id: query.id, raw: query.raw_text }])
  }

  const issues: DataQualityIssue[] = []
  for (const [key, group] of seen) {
    if (group.length < 2) continue
    issues.push({
      issueType: 'duplicate_query',
      severity: 'medium',
      detail: `${group.length} query rows share the normalized key "${key}".`,
      affectedIds: group.map((g) => g.id),
      recommendation:
        'Queries are unique on (organization, normalized_text, intent); duplicates indicate a bypass of the normalizer.',
    })
  }
  return issues
}

/** Malformed URLs in citations and pages. */
export function findMalformedUrls(
  rows: Array<{ id: string; url: string }>
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = []
  for (const row of rows) {
    const url = (row.url ?? '').trim()
    let malformed = false
    if (!/^https?:\/\//i.test(url)) malformed = true
    else {
      try {
        const parsed = new URL(url)
        if (!parsed.hostname.includes('.')) malformed = true
      } catch {
        malformed = true
      }
    }

    if (malformed) {
      issues.push({
        issueType: 'malformed_url',
        severity: 'low',
        detail: `Not a usable URL: "${truncate(url, 120)}"`,
        affectedIds: [row.id],
        recommendation: 'Correct or remove the record; malformed URLs cannot be classified as sources.',
      })
    }
  }
  return issues
}

/**
 * Markets with no location or service linkage, which makes them unscorable.
 * This is the check that catches a partial seed or a bad manual import.
 */
export function findUnlinkedMarkets(
  markets: Array<{ id: string; location_id: string | null; service_id: string | null }>
): DataQualityIssue[] {
  const issues: DataQualityIssue[] = []
  for (const market of markets) {
    if (!market.location_id || !market.service_id) {
      issues.push({
        issueType: market.location_id ? 'missing_service' : 'missing_location',
        severity: 'high',
        detail:
          `Market ${market.id} is missing ${!market.location_id ? 'a location' : ''}` +
          `${!market.location_id && !market.service_id ? ' and ' : ''}` +
          `${!market.service_id ? 'a service' : ''}. It cannot be scored.`,
        affectedIds: [market.id],
        recommendation: 'Relink or remove the market so scores do not silently omit it.',
      })
    }
  }
  return issues
}

/** Behaviours that would indicate a guardrail breach rather than a data issue. */
export function findProhibitedPatterns(
  responses: Array<{ id: string; raw_response_text: string }>
): DataQualityIssue[] {
  // The engine must never author an answer; a response whose stored text is
  // empty or a template marker indicates a bug, not a real observation.
  const placeholder = /\{\{|\[BUSINESS BRAIN\]|PLACEHOLDER|LOREM IPSUM/i
  const issues: DataQualityIssue[] = []

  for (const response of responses) {
    const text = response.raw_response_text ?? ''
    if (text.trim().length === 0) {
      issues.push({
        issueType: 'orphan_record',
        severity: 'high',
        detail: `Response ${response.id} has empty text but was recorded as collected.`,
        affectedIds: [response.id],
        recommendation: 'Investigate the adapter: an empty answer must be recorded as a failure, not a success.',
      })
    } else if (placeholder.test(text)) {
      issues.push({
        issueType: 'orphan_record',
        severity: 'high',
        detail: `Response ${response.id} contains placeholder text.`,
        affectedIds: [response.id],
        recommendation: 'A stored response must be verbatim provider output. Investigate immediately.',
      })
    }
  }
  return issues
}

export function summarizeIssues(issues: DataQualityIssue[]): {
  total: number
  bySeverity: Record<string, number>
  byType: Record<string, number>
} {
  const bySeverity: Record<string, number> = {}
  const byType: Record<string, number> = {}

  for (const issue of issues) {
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1
    byType[issue.issueType] = (byType[issue.issueType] ?? 0) + 1
  }

  return { total: issues.length, bySeverity, byType }
}

function normalizeSite(website: string | null): string | null {
  if (!website) return null
  try {
    return new URL(website).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`
}