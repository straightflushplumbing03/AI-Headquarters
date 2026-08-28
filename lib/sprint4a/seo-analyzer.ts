/**
 * Sprint 4A: Deterministic SEO Signal Analyzer
 *
 * Pure function — no network, no database, no AI calls.
 * All observations are deterministic and reproducible.
 */

import type { ParsedPage } from './page-parser'

export type SeoIssueType =
  | 'missing_title'
  | 'title_too_long'
  | 'title_too_short'
  | 'duplicate_title'
  | 'missing_meta_description'
  | 'meta_description_too_long'
  | 'missing_h1'
  | 'multiple_h1'
  | 'missing_canonical'
  | 'not_indexable'
  | 'thin_content'
  | 'page_error'

export type SeoSeverity = 'low' | 'medium' | 'high'

export interface SeoIssue {
  url: string
  type: SeoIssueType
  severity: SeoSeverity
  message: string
}

// Limits based on common SEO best practice
const TITLE_MAX_CHARS = 60
const TITLE_MIN_CHARS = 10
const META_DESC_MAX_CHARS = 160
const THIN_CONTENT_WORDS = 300

function issueFor(url: string, type: SeoIssueType, severity: SeoSeverity, message: string): SeoIssue {
  return { url, type, severity, message }
}

/**
 * Analyze SEO signals for a single page.
 * Does NOT check for duplicate titles — that requires all pages (see analyzeAllPages).
 */
export function analyzePageIssues(page: ParsedPage): SeoIssue[] {
  const issues: SeoIssue[] = []

  // Skip pages that failed to load — they get a separate page_error issue
  if (page.httpStatus >= 400) {
    issues.push(
      issueFor(page.url, 'page_error', 'high', `Page returned HTTP ${page.httpStatus}`)
    )
    return issues
  }

  // Title
  if (!page.title) {
    issues.push(issueFor(page.url, 'missing_title', 'high', 'Page has no <title> tag'))
  } else if (page.title.length > TITLE_MAX_CHARS) {
    issues.push(
      issueFor(
        page.url,
        'title_too_long',
        'medium',
        `Title is ${page.title.length} characters (max ${TITLE_MAX_CHARS})`
      )
    )
  } else if (page.title.length < TITLE_MIN_CHARS) {
    issues.push(
      issueFor(
        page.url,
        'title_too_short',
        'medium',
        `Title is only ${page.title.length} characters (min ${TITLE_MIN_CHARS})`
      )
    )
  }

  // Meta description
  if (!page.metaDescription) {
    issues.push(
      issueFor(page.url, 'missing_meta_description', 'medium', 'Page has no meta description')
    )
  } else if (page.metaDescription.length > META_DESC_MAX_CHARS) {
    issues.push(
      issueFor(
        page.url,
        'meta_description_too_long',
        'low',
        `Meta description is ${page.metaDescription.length} characters (max ${META_DESC_MAX_CHARS})`
      )
    )
  }

  // H1
  if (page.h1Count === 0) {
    issues.push(issueFor(page.url, 'missing_h1', 'medium', 'Page has no <h1> tag'))
  } else if (page.h1Count > 1) {
    issues.push(
      issueFor(page.url, 'multiple_h1', 'low', `Page has ${page.h1Count} <h1> tags (should have 1)`)
    )
  }

  // Canonical
  if (!page.canonicalUrl) {
    issues.push(issueFor(page.url, 'missing_canonical', 'low', 'Page has no canonical URL tag'))
  }

  // Indexability
  if (!page.isIndexable) {
    issues.push(
      issueFor(page.url, 'not_indexable', 'medium', 'Page is marked as non-indexable (noindex)')
    )
  }

  // Thin content (only flag indexable pages — thin noindex pages may be intentional)
  if (page.isIndexable && page.wordCount < THIN_CONTENT_WORDS) {
    issues.push(
      issueFor(
        page.url,
        'thin_content',
        'low',
        `Page has only ${page.wordCount} words (min ${THIN_CONTENT_WORDS} recommended)`
      )
    )
  }

  return issues
}

/**
 * Analyze SEO signals across ALL pages (needed for duplicate title detection).
 * Returns de-duplicated issues for each page.
 */
export function analyzeAllPages(pages: ParsedPage[]): SeoIssue[] {
  // Per-page issues
  const allIssues: SeoIssue[] = pages.flatMap(analyzePageIssues)

  // Duplicate title detection
  const titleMap = new Map<string, string[]>() // title → urls
  for (const page of pages) {
    if (page.title && page.httpStatus < 400) {
      const key = page.title.toLowerCase().trim()
      const existing = titleMap.get(key) ?? []
      titleMap.set(key, [...existing, page.url])
    }
  }

  for (const [, urls] of titleMap.entries()) {
    if (urls.length > 1) {
      for (const url of urls) {
        allIssues.push(
          issueFor(url, 'duplicate_title', 'medium', `Title is shared by ${urls.length} pages`)
        )
      }
    }
  }

  return allIssues
}
