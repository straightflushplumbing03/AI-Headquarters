/**
 * AI Authority Engine -- technical SEO monitoring and internal-link analysis.
 *
 * Both modules DETECT and RECOMMEND. Neither modifies production. Every finding
 * carries the evidence that produced it, so a recommendation can be checked
 * rather than trusted.
 *
 * The doorway-page check is the one that matters most for a city x service
 * matrix: the failure mode this whole subsystem could fall into is generating
 * twenty interchangeable city pages, which is explicitly prohibited. So
 * similarity is measured, not assumed away.
 */

import { detectDoorwaySimilarity } from './guardrails'

export type TechnicalIssueType =
  | 'broken_link'
  | 'http_error'
  | 'redirect_chain'
  | 'canonical_mismatch'
  | 'duplicate_title'
  | 'duplicate_meta_description'
  | 'missing_title'
  | 'missing_h1'
  | 'missing_schema'
  | 'invalid_schema'
  | 'orphan_page'
  | 'sitemap_problem'
  | 'robots_issue'
  | 'slow_page'
  | 'mobile_issue'
  | 'thin_content'
  | 'doorway_page_risk'
  | 'duplicate_content'

export interface TechnicalFinding {
  url: string
  issueType: TechnicalIssueType
  severity: 'low' | 'medium' | 'high' | 'critical'
  detail: string
  recommendation: string
}

export interface PageForAudit {
  url: string
  status_code: number | null
  title: string | null
  meta_description: string | null
  h1: string | null
  canonical_url: string | null
  indexable: boolean | null
  content_word_count: number | null
  schema_types: string[] | null
  content_hash: string | null
  content_sample?: string | null
}

export interface LinkEdge {
  from_url: string
  to_url: string
  anchor_text: string | null
}

/** Detect cases where a link target 404s or errors. */
export function findBrokenLinks(pages: PageForAudit[], links: LinkEdge[]): TechnicalFinding[] {
  const byUrl = new Map(pages.map((p) => [normalizeUrl(p.url), p]))
  const findings: TechnicalFinding[] = []
  const seen = new Set<string>()

  for (const link of links) {
    const target = byUrl.get(normalizeUrl(link.to_url))
    if (!target) continue
    const status = target.status_code ?? 200
    if (status >= 400) {
      const key = `${link.to_url}:${status}`
      if (seen.has(key)) continue
      seen.add(key)
      findings.push({
        url: link.to_url,
        issueType: status >= 500 ? 'http_error' : 'broken_link',
        severity: status >= 500 ? 'high' : 'critical',
        detail: `Linked from ${link.from_url} but returns HTTP ${status}.`,
        recommendation:
          'Fix or remove the link, or restore the target page. Broken internal links waste authority and hurt user experience.',
      })
    }
  }

  return findings
}

/** Duplicate / missing metadata, thin content, missing schema, orphans. */
export function auditPageMetadata(pages: PageForAudit[]): TechnicalFinding[] {
  const findings: TechnicalFinding[] = []

  const titles = new Map<string, string[]>()
  const metas = new Map<string, string[]>()

  for (const page of pages) {
    if ((page.status_code ?? 200) >= 400) continue

    if (!page.title || page.title.trim().length === 0) {
      findings.push({
        url: page.url,
        issueType: 'missing_title',
        severity: 'high',
        detail: 'Page has no title tag.',
        recommendation: 'Add a descriptive, unique title tag that names the service and the city.',
      })
    } else {
      const key = page.title.trim().toLowerCase()
      titles.set(key, [...(titles.get(key) ?? []), page.url])
    }

    if (!page.meta_description || page.meta_description.trim().length === 0) {
      findings.push({
        url: page.url,
        issueType: 'duplicate_meta_description',
        severity: 'low',
        detail: 'Page has no meta description.',
        recommendation: 'Add a unique, accurate meta description.',
      })
    } else {
      const key = page.meta_description.trim().toLowerCase()
      metas.set(key, [...(metas.get(key) ?? []), page.url])
    }

    if (!page.h1 || page.h1.trim().length === 0) {
      findings.push({
        url: page.url,
        issueType: 'missing_h1',
        severity: 'medium',
        detail: 'Page has no H1 heading.',
        recommendation: 'Add a single descriptive H1.',
      })
    }

    const words = page.content_word_count ?? 0
    if (words > 0 && words < 300) {
      findings.push({
        url: page.url,
        issueType: 'thin_content',
        severity: 'medium',
        detail: `Page has only ${words} words.`,
        recommendation:
          'Expand with genuinely useful, locally specific content and real evidence. Do not pad with repeated city names.',
      })
    }

    const schemaTypes = page.schema_types ?? []
    if (schemaTypes.includes('invalid-json-ld')) {
      findings.push({
        url: page.url,
        issueType: 'invalid_schema',
        severity: 'medium',
        detail: 'Page contains JSON-LD that does not parse.',
        recommendation: 'Fix the structured data so it is valid JSON and accurately describes visible content.',
      })
    } else if (schemaTypes.length === 0 && words >= 300) {
      findings.push({
        url: page.url,
        issueType: 'missing_schema',
        severity: 'low',
        detail: 'Page has no structured data.',
        recommendation:
          'Consider appropriate, truthful schema (Service, LocalBusiness, FAQPage) for content that is actually visible.',
      })
    }

    if (page.canonical_url && normalizeUrl(page.canonical_url) !== normalizeUrl(page.url)) {
      findings.push({
        url: page.url,
        issueType: 'canonical_mismatch',
        severity: 'medium',
        detail: `Canonical points to ${page.canonical_url} instead of itself.`,
        recommendation: 'Confirm the canonical is intentional; a self-referencing canonical is the safe default.',
      })
    }
  }

  for (const [title, urls] of titles) {
    if (urls.length < 2) continue
    for (const url of urls) {
      findings.push({
        url,
        issueType: 'duplicate_title',
        severity: 'medium',
        detail: `Title shared by ${urls.length} pages: "${truncate(title, 80)}".`,
        recommendation: 'Give each page a unique title reflecting its specific service and city.',
      })
    }
  }

  for (const urls of metas.values()) {
    if (urls.length < 2) continue
    for (const url of urls) {
      findings.push({
        url,
        issueType: 'duplicate_meta_description',
        severity: 'low',
        detail: `Meta description shared by ${urls.length} pages.`,
        recommendation: 'Write a unique description per page.',
      })
    }
  }

  return findings
}

/** Pages that nothing links to and that are not the site root. */
export function findOrphanPages(pages: PageForAudit[], links: LinkEdge[]): TechnicalFinding[] {
  const inbound = new Set<string>()
  for (const link of links) inbound.add(normalizeUrl(link.to_url))

  const findings: TechnicalFinding[] = []
  for (const page of pages) {
    if ((page.status_code ?? 200) >= 400) continue
    if (page.indexable === false) continue
    const url = normalizeUrl(page.url)
    if (isRootUrl(url)) continue
    if (inbound.has(url)) continue

    findings.push({
      url: page.url,
      issueType: 'orphan_page',
      severity: 'medium',
      detail: 'No internal page links to this URL.',
      recommendation:
        'Add internal links from relevant service, city, and project pages so the page is reachable and its relationship to other content is clear.',
    })
  }

  return findings
}

/**
 * Doorway-page risk: city pages that are the same page with the name swapped.
 * Uses the same similarity measure as the content guardrails so the definition
 * of "too similar" is consistent across the system.
 */
export function findDoorwayRisk(
  pages: Array<PageForAudit & { locationName?: string | null }>
): TechnicalFinding[] {
  const candidates = pages
    .filter((p) => (p.status_code ?? 200) < 400)
    .filter((p) => (p.content_sample ?? '').length > 200)
    .map((p) => ({
      locationName: p.locationName ?? extractCityGuess(p.title ?? p.url),
      text: p.content_sample ?? '',
      url: p.url,
    }))
    .filter((p) => p.locationName.length > 0)

  if (candidates.length < 2) return []

  const similarities = detectDoorwaySimilarity(
    candidates.map((c) => ({ locationName: c.locationName, text: c.text }))
  )

  const findings: TechnicalFinding[] = []
  for (const pair of similarities) {
    const page = candidates.find((c) => c.locationName === pair.a)
    if (!page) continue
    findings.push({
      url: page.url,
      issueType: 'doorway_page_risk',
      severity: pair.similarity >= 0.95 ? 'high' : 'medium',
      detail:
        `Page content is ${(pair.similarity * 100).toFixed(0)}% identical to the ${pair.b} page ` +
        `once the city name is removed.`,
      recommendation:
        'Make this page genuinely specific: real local projects, real local reviews, local problems and ' +
        'geography. Interchangeable city pages are prohibited by the project guardrails.',
    })
  }

  return findings
}

export interface InternalLinkRecommendation {
  fromUrl: string
  toUrl: string
  reason: string
  priority: 'high' | 'medium' | 'low'
}

/**
 * Recommend internal links for a market's page.
 *
 * Only recommends links that do not already exist, and only between pages whose
 * relationship is meaningful (same city, same service, or a project that
 * supports the service). It never invents a page.
 */
export function recommendInternalLinks(params: {
  marketPageUrl: string
  locationName: string
  serviceName: string
  pages: Array<{ url: string; title: string | null; content_word_count: number | null }>
  existingLinks: LinkEdge[]
}): InternalLinkRecommendation[] {
  const { marketPageUrl, locationName, serviceName, pages, existingLinks } = params

  const alreadyLinked = new Set(
    existingLinks
      .filter((l) => normalizeUrl(l.from_url) === normalizeUrl(marketPageUrl))
      .map((l) => normalizeUrl(l.to_url))
  )

  const location = locationName.toLowerCase()
  const service = serviceName.toLowerCase()
  const serviceTokens = service.split(/[\s/]+/).filter((t) => t.length > 3)

  const recommendations: InternalLinkRecommendation[] = []

  for (const page of pages) {
    const url = normalizeUrl(page.url)
    if (url === normalizeUrl(marketPageUrl)) continue
    if (alreadyLinked.has(url)) continue

    const haystack = `${page.url} ${page.title ?? ''}`.toLowerCase()
    const matchesService = serviceTokens.some((token) => haystack.includes(token))
    const matchesLocation = haystack.includes(location)

    if (matchesService && matchesLocation) {
      recommendations.push({
        fromUrl: marketPageUrl,
        toUrl: page.url,
        reason: 'Same city and same service: a direct, highly relevant relationship.',
        priority: 'high',
      })
    } else if (matchesService) {
      recommendations.push({
        fromUrl: marketPageUrl,
        toUrl: page.url,
        reason: `Same service (${serviceName}) without the city qualifier: connects the market page to service authority.`,
        priority: 'medium',
      })
    } else if (matchesLocation) {
      recommendations.push({
        fromUrl: marketPageUrl,
        toUrl: page.url,
        reason: `Same city (${locationName}): strengthens the local content cluster.`,
        priority: 'medium',
      })
    }
  }

  const priorityRank = { high: 0, medium: 1, low: 2 }
  return recommendations.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]).slice(0, 25)
}

/** Pages that receive no inbound internal links, as URLs. */
export function findWeaklyLinkedPages(pages: PageForAudit[], links: LinkEdge[]): string[] {
  const inbound = new Map<string, number>()
  for (const link of links) {
    const key = normalizeUrl(link.to_url)
    inbound.set(key, (inbound.get(key) ?? 0) + 1)
  }
  return pages
    .filter((p) => (p.status_code ?? 200) < 400 && (p.indexable ?? true))
    .filter((p) => (inbound.get(normalizeUrl(p.url)) ?? 0) === 0)
    .map((p) => p.url)
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${parsed.host}${path}`
  } catch {
    return url.replace(/\/+$/, '')
  }
}

function isRootUrl(normalized: string): boolean {
  return normalized.endsWith('/') || !normalized.includes('/')
}

/** Best-effort city extraction for doorway comparison when no mapping exists. */
function extractCityGuess(value: string): string {
  const tokens = value.split(/[-/\s]+/).filter((t) => t.length > 3)
  return tokens.slice(0, 2).join(' ')
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`
}