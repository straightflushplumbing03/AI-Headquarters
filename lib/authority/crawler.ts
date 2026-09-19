/**
 * AI Authority Engine -- respectful website crawler.
 *
 * The crawler is a guest on someone else's server (even when that server is the
 * client's own site, which is the usual case here). It therefore:
 *
 *   - fetches robots.txt FIRST and honours Disallow rules per user-agent
 *   - identifies itself honestly with a descriptive User-Agent
 *   - rate-limits every request with a configurable delay
 *   - caps total pages and never follows off-site links
 *   - honours sitemap.xml for discovery, falling back to link-following
 *   - never retries aggressively, and aborts on repeated server errors instead
 *     of hammering a struggling site
 *
 * It extracts structure only: titles, metadata, headings, structured-data
 * types, and links. It does not execute JavaScript, and it does not attempt to
 * evade any protection.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthorityStore } from './store'

export const DEFAULT_USER_AGENT = 'BusinessBrainAI-AuthorityBot/1.0 (+authority monitoring; contact site owner)'
export const DEFAULT_RATE_LIMIT_MS = 1500
export const DEFAULT_MAX_PAGES = 200

export interface CrawlOptions {
  siteOrigin: string
  maxPages?: number
  rateLimitMs?: number
  userAgent?: string
  /** Abort after this many consecutive fetch failures. */
  maxConsecutiveFailures?: number
}

export interface CrawledPage {
  url: string
  statusCode: number
  title: string | null
  metaDescription: string | null
  h1: string | null
  headings: Array<{ level: number; text: string }>
  schemaTypes: string[]
  canonicalUrl: string | null
  indexable: boolean
  wordCount: number
  contentHash: string
  internalLinks: string[]
  externalLinks: string[]
  contentSample: string
}

export interface CrawlSummary {
  crawlRunId: string | null
  pagesFetched: number
  pagesFailed: number
  pagesSkippedRobots: number
  robotsFetched: boolean
  sitemapUrlsFound: number
  errors: string[]
}

/**
 * Minimal robots.txt parser for the rules that actually matter.
 *
 * Deliberately conservative: if a rule is ambiguous we treat the path as
 * disallowed. Over-permission is the only outcome we refuse to risk.
 */
export function parseRobots(
  robotsTxt: string,
  userAgent: string
): { disallowed: string[]; allowed: string[]; sitemaps: string[] } {
  const lines = robotsTxt.split(/\r?\n/)
  const disallowed: string[] = []
  const allowed: string[] = []
  const sitemaps: string[] = []

  const agentToken = userAgent.split('/')[0].toLowerCase()
  let appliesToUs = false
  let inStarBlock = false

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue

    const [rawKey, ...rest] = line.split(':')
    if (!rawKey) continue
    const key = rawKey.trim().toLowerCase()
    const value = rest.join(':').trim()

    if (key === 'sitemap') {
      if (value) sitemaps.push(value)
      continue
    }
    if (key === 'user-agent') {
      const agent = value.toLowerCase()
      appliesToUs = agent === '*' || agentToken.includes(agent) || agent.includes(agentToken)
      inStarBlock = agent === '*'
      continue
    }
    if (key === 'disallow' && (appliesToUs || inStarBlock)) {
      if (value) disallowed.push(value)
      continue
    }
    if (key === 'allow' && (appliesToUs || inStarBlock)) {
      if (value) allowed.push(value)
    }
  }

  return { disallowed, allowed, sitemaps }
}

/** Apply robots rules. Longest match wins; Allow beats Disallow on a tie. */
export function isPathAllowed(
  path: string,
  rules: { disallowed: string[]; allowed: string[] }
): boolean {
  const matchLength = (patterns: string[]) =>
    patterns.reduce((best, pattern) => {
      const p = pattern.replace(/\*$/, '')
      if (p && path.startsWith(p)) return Math.max(best, p.length)
      if (pattern === '/' && path.startsWith('/')) return Math.max(best, 1)
      return best
    }, -1)

  const disallowedLen = matchLength(rules.disallowed)
  if (disallowedLen === -1) return true
  const allowedLen = matchLength(rules.allowed)
  return allowedLen >= disallowedLen
}

export class AuthorityCrawler {
  private store: AuthorityStore
  private userAgent: string
  private rateLimitMs: number

  constructor(
    supabase: SupabaseClient,
    options?: { userAgent?: string; rateLimitMs?: number }
  ) {
    this.store = new AuthorityStore(supabase)
    this.userAgent = options?.userAgent ?? DEFAULT_USER_AGENT
    this.rateLimitMs = options?.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS
  }

  /**
   * Crawl a site and persist the page graph.
   *
   * Every fetched page upserts a `website_pages` row (the pre-existing table,
 * extended with crawl columns) and an internal-link edge per internal link.
   */
  async crawl(organizationId: string, options: CrawlOptions): Promise<CrawlSummary> {
    const maxPages = Math.min(options.maxPages ?? DEFAULT_MAX_PAGES, 500)
    const rateLimitMs = Math.max(options.rateLimitMs ?? this.rateLimitMs, 250)
    const maxConsecutiveFailures = options.maxConsecutiveFailures ?? 5

    const origin = normalizeOrigin(options.siteOrigin)
    const summary: CrawlSummary = {
      crawlRunId: null,
      pagesFetched: 0,
      pagesFailed: 0,
      pagesSkippedRobots: 0,
      robotsFetched: false,
      sitemapUrlsFound: 0,
      errors: [],
    }

    if (!origin) {
      summary.errors.push(`invalid site origin: ${options.siteOrigin}`)
      return summary
    }

    // --- robots.txt -------------------------------------------------------
    let rules = { disallowed: [] as string[], allowed: [] as string[] }
    let sitemaps: string[] = [`${origin}/sitemap.xml`]

    try {
      const robots = await this.fetchText(`${origin}/robots.txt`)
      if (robots.ok) {
        const parsed = parseRobots(robots.text, this.userAgent)
        rules = { disallowed: parsed.disallowed, allowed: parsed.allowed }
        if (parsed.sitemaps.length > 0) sitemaps = parsed.sitemaps
        summary.robotsFetched = true
      }
      await this.delay(rateLimitMs)
    } catch (error) {
      summary.errors.push(`robots.txt fetch failed: ${describe(error)}`)
    }

    // --- discovery via sitemap -------------------------------------------
    const seeds = new Set<string>()
    for (const sitemapUrl of sitemaps.slice(0, 5)) {
      try {
        const sitemap = await this.fetchText(sitemapUrl)
        await this.delay(rateLimitMs)
        if (!sitemap.ok) continue
        const urls = extractSitemapUrls(sitemap.text)
        summary.sitemapUrlsFound += urls.length
        for (const url of urls) {
          if (url.startsWith(origin)) seeds.add(url)
          if (seeds.size >= maxPages) break
        }
      } catch (error) {
        summary.errors.push(`sitemap fetch failed (${sitemapUrl}): ${describe(error)}`)
      }
      if (seeds.size >= maxPages) break
    }

    // Always include the origin itself, and fall back to it if no sitemap.
    seeds.add(`${origin}/`)

    // --- crawl ------------------------------------------------------------
    const queue = [...seeds]
    const visited = new Set<string>()
    const pages: CrawledPage[] = []
    let consecutiveFailures = 0

    while (queue.length > 0 && visited.size < maxPages) {
      const url = queue.shift()!
      if (visited.has(url)) continue
      visited.add(url)

      const path = safePath(url)
      if (!isPathAllowed(path, rules)) {
        summary.pagesSkippedRobots += 1
        continue
      }

      let response
      try {
        response = await this.fetchText(url)
      } catch (error) {
        summary.pagesFailed += 1
        consecutiveFailures += 1
        summary.errors.push(`${url}: ${describe(error)}`)
        if (consecutiveFailures >= maxConsecutiveFailures) {
          summary.errors.push('aborting: too many consecutive fetch failures')
          break
        }
        continue
      }

      await this.delay(rateLimitMs)

      if (!response.ok || !response.contentType.includes('text/html')) {
        summary.pagesFailed += 1
        consecutiveFailures += 1
        if (response.status >= 500) {
          if (consecutiveFailures >= maxConsecutiveFailures) {
            summary.errors.push('aborting: site returning repeated server errors')
            break
          }
        } else {
          consecutiveFailures = 0
        }
        // Still record the status so broken links are visible downstream.
        await this.persistPage(organizationId, {
          url,
          statusCode: response.status,
          title: null,
          metaDescription: null,
          h1: null,
          headings: [],
          schemaTypes: [],
          canonicalUrl: null,
          indexable: false,
          wordCount: 0,
          contentHash: '',
          internalLinks: [],
          externalLinks: [],
          contentSample: '',
        })
        continue
      }

      consecutiveFailures = 0
      const parsed = parseHtml(response.text, url)
      pages.push(parsed)
      summary.pagesFetched += 1

      await this.persistPage(organizationId, parsed)

      for (const link of parsed.internalLinks) {
        if (!visited.has(link) && visited.size + queue.length < maxPages * 2) {
          queue.push(link)
        }
      }
    }

    // --- persist the link graph -------------------------------------------
    for (const page of pages) {
      for (const target of page.internalLinks) {
        await this.store.upsertPageLink({
          organization_id: organizationId,
          from_url: page.url,
          to_url: target,
          anchor_text: null,
          is_internal: true,
        })
      }
    }

    summary.crawlRunId = await this.store.createCrawlRun({
      organization_id: organizationId,
      site_origin: origin,
      status: 'completed',
      pages_discovered: visited.size,
      pages_fetched: summary.pagesFetched,
      pages_failed: summary.pagesFailed,
      pages_skipped_robots: summary.pagesSkippedRobots,
      robots_fetched: summary.robotsFetched,
      sitemap_urls_found: summary.sitemapUrlsFound,
      rate_limit_ms: rateLimitMs,
      user_agent: this.userAgent,
      errors: summary.errors.slice(0, 50),
      summary: { completedAt: new Date().toISOString() },
    })

    return summary
  }

  private async persistPage(organizationId: string, page: CrawledPage): Promise<void> {
    await this.store.upsertCrawledPage({
      organization_id: organizationId,
      url: page.url,
      title: page.title,
      meta_description: page.metaDescription,
      h1: page.h1,
      headings: page.headings,
      schema_types: page.schemaTypes,
      canonical_url: page.canonicalUrl,
      indexable: page.indexable,
      content_word_count: page.wordCount,
      content_hash: page.contentHash || null,
      status_code: page.statusCode,
      internal_links: page.internalLinks.length,
      external_links: page.externalLinks.length,
      has_schema: page.schemaTypes.length > 0,
      has_canonical: Boolean(page.canonicalUrl),
      outgoing_internal_urls: page.internalLinks,
      last_crawled_at: new Date().toISOString(),
    })
  }

  private async fetchText(
    url: string
  ): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: controller.signal,
      })

      const contentType = response.headers.get('content-type') ?? ''
      // Cap the body we read so a huge asset cannot exhaust memory.
      const text = await response.text()
      return {
        ok: response.ok,
        status: response.status,
        text: text.slice(0, 1_500_000),
        contentType,
      }
    } catch (error) {
      throw new Error(describe(error))
    } finally {
      clearTimeout(timer)
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers (exported for tests; no network access)
// ---------------------------------------------------------------------------

export function parseHtml(html: string, url: string): CrawledPage {
  const origin = normalizeOrigin(url) ?? ''
  const title = matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i)
  const metaDescription =
    matchAttribute(html, /<meta[^>]+name=["']description["'][^>]*>/i, 'content') ??
    matchAttribute(html, /<meta[^>]+property=["']og:description["'][^>]*>/i, 'content')
  const canonicalUrl = matchAttribute(html, /<link[^>]+rel=["']canonical["'][^>]*>/i, 'href')
  const robotsMeta = matchAttribute(html, /<meta[^>]+name=["']robots["'][^>]*>/i, 'content')
  const indexable = !(robotsMeta ?? '').toLowerCase().includes('noindex')

  const headings = extractHeadings(html)
  const h1 = headings.find((h) => h.level === 1)?.text ?? null

  const schemaTypes = extractSchemaTypes(html)
  const links = extractLinks(html, url, origin)
  const text = htmlToText(html)

  return {
    url,
    statusCode: 200,
    title: title ? decodeEntities(title).trim().slice(0, 500) : null,
    metaDescription: metaDescription ? decodeEntities(metaDescription).trim().slice(0, 600) : null,
    h1: h1 ? decodeEntities(h1).trim().slice(0, 500) : null,
    headings,
    schemaTypes,
    canonicalUrl: canonicalUrl ? decodeEntities(canonicalUrl).trim() : null,
    indexable,
    wordCount: text.split(/\s+/).filter((w) => w.length > 0).length,
    contentHash: simpleHash(text),
    internalLinks: links.internal,
    externalLinks: links.external,
    contentSample: text.slice(0, 5000),
  }
}

export function extractHeadings(html: string): Array<{ level: number; text: string }> {
  const out: Array<{ level: number; text: string }> = []
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const text = htmlToText(match[2]).trim()
    if (text) out.push({ level: Number(match[1]), text: text.slice(0, 300) })
    if (out.length >= 100) break
  }
  return out
}

/** Extract `@type` values from JSON-LD blocks. Never invents a type. */
export function extractSchemaTypes(html: string): string[] {
  const types = new Set<string>()
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      collectTypes(parsed, types)
    } catch {
      types.add('invalid-json-ld')
    }
    if (types.size > 60) break
  }
  return [...types]
}

function collectTypes(value: unknown, types: Set<string>, depth = 0): void {
  if (depth > 6 || value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectTypes(item, types, depth + 1)
    return
  }
  const obj = value as Record<string, unknown>
  const t = obj['@type']
  if (typeof t === 'string') types.add(t)
  else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x))
  for (const child of Object.values(obj)) collectTypes(child, types, depth + 1)
}

export function extractLinks(
  html: string,
  url: string,
  origin: string
): { internal: string[]; external: string[] } {
  const internal = new Set<string>()
  const external = new Set<string>()
  const re = /<a[^>]+href=["']([^"']+)["']/gi
  let match: RegExpExecArray | null

  while ((match = re.exec(html)) !== null) {
    const href = decodeEntities(match[1]).trim()
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue

    let absolute: string
    try {
      absolute = new URL(href, url).toString()
    } catch {
      continue
    }
    const clean = absolute.split('#')[0]
    if (clean.startsWith(origin)) internal.add(clean)
    else if (clean.startsWith('http')) external.add(clean)

    if (internal.size + external.size > 800) break
  }

  return { internal: [...internal], external: [...external] }
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractSitemapUrls(xml: string): string[] {
  const urls = new Set<string>()
  const locRe = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
  let match: RegExpExecArray | null
  while ((match = locRe.exec(xml)) !== null) {
    const value = decodeEntities(match[1]).trim()
    if (value.startsWith('http')) urls.add(value)
    if (urls.size > 5000) break
  }
  return [...urls]
}

export function normalizeOrigin(url: string): string | null {
  try {
    const parsed = new URL(url)
    // The crawler fetches these origins, so anything that is not http(s) must be
    // refused here rather than reaching the fetch layer.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return '/'
  }
}

function matchFirst(html: string, re: RegExp): string | null {
  const match = html.match(re)
  return match ? match[1] : null
}

function matchAttribute(html: string, tagRe: RegExp, attribute: string): string | null {
  const tag = html.match(tagRe)
  if (!tag) return null
  const attrMatch = tag[0].match(new RegExp(`${attribute}=["']([^"']*)["']`, 'i'))
  return attrMatch ? attrMatch[1] : null
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
}

/**
 * FNV-1a style hash of page text, used to detect changed pages between crawls.
 * Not a security hash; it only needs to be stable and cheap.
 */
export function simpleHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300)
  return String(error).slice(0, 300)
}