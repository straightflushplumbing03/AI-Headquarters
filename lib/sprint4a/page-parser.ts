/**
 * Sprint 4A: Pure HTML Page Parser
 *
 * No network I/O, no database, no AI calls.
 * Uses regex-based parsing — avoids adding new dependencies.
 * Fully deterministic and unit-testable.
 */

export interface ParsedPage {
  url: string
  httpStatus: number
  title: string | null
  metaDescription: string | null
  canonicalUrl: string | null
  h1: string | null
  h1Count: number
  wordCount: number
  isIndexable: boolean
  internalLinks: string[]
  fetchedAt: string
}

// ─── Regex helpers ────────────────────────────────────────────────────────────

/** Extract <title>…</title> */
function parseTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? m[1].replace(/\s+/g, ' ').trim() : null
}

/** Extract <meta name="description" content="…"> (handles attribute ordering) */
function parseMetaDescription(html: string): string | null {
  // name before content
  let m = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*?)["'][^>]*>/i)
  if (m) return m[1].trim() || null
  // content before name
  m = html.match(/<meta[^>]+content=["']([^"']*?)["'][^>]*name=["']description["'][^>]*>/i)
  return m ? (m[1].trim() || null) : null
}

/** Extract <link rel="canonical" href="…"> */
function parseCanonicalUrl(html: string): string | null {
  // rel before href
  let m = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)
  if (m) return m[1].trim() || null
  // href before rel
  m = html.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i)
  return m ? (m[1].trim() || null) : null
}

/** Extract first <h1>…</h1> text content (strips inner tags) */
function parseH1(html: string): string | null {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (!m) return null
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || null
}

/** Count all <h1> tags */
function countH1s(html: string): number {
  const m = html.match(/<h1[/>\s]/gi)
  return m ? m.length : 0
}

/**
 * Determine if page is indexable.
 * Checks:
 *   1. <meta name="robots" content="noindex">
 *   2. X-Robots-Tag response header (passed separately)
 */
function parseIndexable(html: string, xRobotsTag?: string | null): boolean {
  // Check meta robots
  const metaRobots =
    html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1]?.toLowerCase() ||
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']robots["'][^>]*>/i)?.[1]?.toLowerCase()

  if (metaRobots && (metaRobots.includes('noindex') || metaRobots === 'none')) return false

  // Check X-Robots-Tag header
  if (xRobotsTag) {
    const tag = xRobotsTag.toLowerCase()
    if (tag.includes('noindex') || tag === 'none') return false
  }

  return true
}

/** Count words in visible text (strips HTML tags) */
function countWords(html: string): number {
  // Remove scripts and styles first
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const text = noScript.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return 0
  return text.split(' ').filter((w) => w.length > 0).length
}

/**
 * Extract internal links from anchor hrefs.
 * Returns absolute URLs that belong to the same domain.
 */
export function extractInternalLinks(html: string, baseUrl: string, domain: string): string[] {
  const hrefRegex = /href=["']([^"'#?]+)["']/gi
  const links = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1].trim()
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
      continue
    }

    try {
      const absolute = new URL(href, baseUrl).href
      const parsed = new URL(absolute)
      // Same-domain only, no fragments
      if (parsed.hostname === domain) {
        // Normalize: remove trailing slash for non-root paths
        const normalized = parsed.origin + parsed.pathname.replace(/\/$/, '') || parsed.origin + '/'
        links.add(normalized)
      }
    } catch {
      // Malformed URL — skip
    }
  }

  return Array.from(links)
}

/**
 * Parse raw HTML + HTTP response into a structured page record.
 * The `xRobotsTag` is the value of the `X-Robots-Tag` HTTP header, if present.
 */
export function parseHtmlPage(
  url: string,
  httpStatus: number,
  html: string,
  domain: string,
  xRobotsTag?: string | null
): ParsedPage {
  return {
    url,
    httpStatus,
    title: parseTitle(html),
    metaDescription: parseMetaDescription(html),
    canonicalUrl: parseCanonicalUrl(html),
    h1: parseH1(html),
    h1Count: countH1s(html),
    wordCount: countWords(html),
    isIndexable: httpStatus < 400 && parseIndexable(html, xRobotsTag),
    internalLinks: httpStatus < 400 ? extractInternalLinks(html, url, domain) : [],
    fetchedAt: new Date().toISOString(),
  }
}
