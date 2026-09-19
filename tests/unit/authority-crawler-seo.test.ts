/**
 * AI Authority Engine -- crawler politeness, technical SEO, and guardrail tests.
 *
 * The crawler tests are the most important safety tests in this suite. This
 * system fetches a third party's website on a schedule. Getting robots.txt wrong
 * is not a metric bug, it is a violation of the site owner's stated wishes, so
 * the conservative direction is asserted explicitly.
 */

import { describe, it, expect } from 'vitest'
import { isPathAllowed, parseRobots, normalizeOrigin, simpleHash } from '@/lib/authority/crawler'
import {
  auditPageMetadata,
  findBrokenLinks,
  findDoorwayRisk,
  findOrphanPages,
  recommendInternalLinks,
  type LinkEdge,
  type PageForAudit,
} from '@/lib/authority/technical-seo'
import {
  findDuplicateCompetitors,
  findMalformedUrls,
  findProhibitedPatterns,
} from '@/lib/authority/data-quality'

const BOT = 'BusinessBrainAI-AuthorityBot/1.0'

function page(overrides: Partial<PageForAudit> & { url: string }): PageForAudit {
  return {
    status_code: 200,
    title: null,
    meta_description: null,
    h1: null,
    canonical_url: null,
    indexable: true,
    content_word_count: 500,
    schema_types: [],
    content_hash: null,
    content_sample: null,
    ...overrides,
  }
}

describe('robots.txt parsing', () => {
  it('collects disallow rules for a matching user agent', () => {
    const rules = parseRobots(
      ['User-agent: BusinessBrainAI-AuthorityBot', 'Disallow: /private', 'Sitemap: https://x.com/sitemap.xml'].join('\n'),
      BOT
    )
    expect(rules.disallowed).toContain('/private')
    expect(rules.sitemaps).toContain('https://x.com/sitemap.xml')
  })

  it('applies wildcard rules to us', () => {
    const rules = parseRobots(['User-agent: *', 'Disallow: /admin'].join('\n'), BOT)
    expect(rules.disallowed).toContain('/admin')
  })

  it('ignores comments and blank lines', () => {
    const rules = parseRobots(
      ['# a comment', '', 'User-agent: *', 'Disallow: /secret # inline comment'].join('\n'),
      BOT
    )
    expect(rules.disallowed).toContain('/secret')
  })

  it('blocks a disallowed path', () => {
    const rules = parseRobots(['User-agent: *', 'Disallow: /private'].join('\n'), BOT)
    expect(isPathAllowed('/private/data', rules)).toBe(false)
  })

  it('allows an unrelated path', () => {
    const rules = parseRobots(['User-agent: *', 'Disallow: /private'].join('\n'), BOT)
    expect(isPathAllowed('/services/leak-detection', rules)).toBe(true)
  })

  it('lets a longer Allow override a shorter Disallow', () => {
    const rules = parseRobots(
      ['User-agent: *', 'Disallow: /private', 'Allow: /private/public'].join('\n'),
      BOT
    )
    expect(isPathAllowed('/private/public/page', rules)).toBe(true)
    expect(isPathAllowed('/private/other', rules)).toBe(false)
  })

  it('treats a bare Disallow: / as blocking everything', () => {
    const rules = parseRobots(['User-agent: *', 'Disallow: /'].join('\n'), BOT)
    expect(isPathAllowed('/any-page', rules)).toBe(false)
  })

  it('is permissive by default when no rules exist', () => {
    expect(isPathAllowed('/anything', { disallowed: [], allowed: [] })).toBe(true)
  })

  it('does not let another agent\u2019s block apply to us', () => {
    const rules = parseRobots(
      ['User-agent: SomeOtherBot', 'Disallow: /theirs', 'User-agent: *', 'Disallow: /ours'].join('\n'),
      BOT
    )
    expect(rules.disallowed).toContain('/ours')
  })
})

describe('normalizeOrigin', () => {
  it('reduces a url to scheme and host', () => {
    expect(normalizeOrigin('https://example.com/some/page?a=1')).toBe('https://example.com')
  })

  it('rejects a non-http scheme', () => {
    expect(normalizeOrigin('ftp://example.com')).toBeNull()
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull()
  })

  it('returns null for a malformed url rather than throwing', () => {
    expect(normalizeOrigin('not a url')).toBeNull()
  })
})

describe('simpleHash', () => {
  it('is stable for identical input', () => {
    expect(simpleHash('abc')).toBe(simpleHash('abc'))
  })

  it('differs for different input', () => {
    expect(simpleHash('abc')).not.toBe(simpleHash('abd'))
  })
})

describe('broken link detection', () => {
  it('flags a link whose target returns 404', () => {
    // Status comes from the crawled target page itself, which is what the
    // crawler actually observed.
    const findings = findBrokenLinks(
      [page({ url: 'https://x.com/a' }), page({ url: 'https://x.com/missing', status_code: 404 })],
      [{ from_url: 'https://x.com/a', to_url: 'https://x.com/missing', anchor_text: 'gone' }]
    )
    expect(findings.some((f) => f.issueType === 'broken_link')).toBe(true)
  })

  it('reports an internal link to a 500 as broken, at higher severity', () => {
    const findings = findBrokenLinks(
      [page({ url: 'https://x.com/a' }), page({ url: 'https://x.com/error', status_code: 500 })],
      [{ from_url: 'https://x.com/a', to_url: 'https://x.com/error', anchor_text: 'err' }]
    )
    expect(findings.length).toBeGreaterThan(0)
    expect(findings[0].issueType).toBe('http_error')
    expect(findings[0].severity).toBe('high')
  })

  it('ignores a link target that was never crawled', () => {
    // Not crawled is unknown, not broken. Reporting it would be a fabricated finding.
    const findings = findBrokenLinks(
      [page({ url: 'https://x.com/a' })],
      [{ from_url: 'https://x.com/a', to_url: 'https://external.example/x', anchor_text: 'ext' }]
    )
    expect(findings).toEqual([])
  })
})

describe('page metadata audit', () => {
  it('flags a missing title', () => {
    const findings = auditPageMetadata([page({ url: 'https://x.com/a', title: null })])
    expect(findings.some((f) => f.issueType.includes('title'))).toBe(true)
  })

  it('flags duplicate titles across pages', () => {
    const findings = auditPageMetadata([
      page({ url: 'https://x.com/a', title: 'Leak Detection Services' }),
      page({ url: 'https://x.com/b', title: 'Leak Detection Services' }),
    ])
    expect(findings.some((f) => f.issueType.includes('duplicate_title'))).toBe(true)
  })

  it('flags duplicate meta descriptions', () => {
    const findings = auditPageMetadata([
      page({ url: 'https://x.com/a', title: 'A', meta_description: 'Same description here.' }),
      page({ url: 'https://x.com/b', title: 'B', meta_description: 'Same description here.' }),
    ])
    expect(findings.some((f) => f.issueType === 'duplicate_meta_description')).toBe(true)
  })

  it('does not flag a missing meta description as a duplicate', () => {
    // A missing description and a shared description are different problems and
    // must not be conflated in the report.
    const findings = auditPageMetadata([
      page({ url: 'https://x.com/a', title: 'A', meta_description: null }),
      page({ url: 'https://x.com/b', title: 'B', meta_description: null }),
    ])
    expect(findings.some((f) => f.issueType === 'duplicate_meta_description')).toBe(false)
  })

  it('flags a missing H1', () => {
    const findings = auditPageMetadata([
      page({ url: 'https://x.com/a', title: 'A', h1: null }),
    ])
    expect(findings.some((f) => f.issueType.includes('h1'))).toBe(true)
  })

  it('flags thin content', () => {
    const findings = auditPageMetadata([
      page({ url: 'https://x.com/a', title: 'A', h1: 'A', content_word_count: 30 }),
    ])
    expect(findings.some((f) => f.issueType.includes('thin'))).toBe(true)
  })

  it('produces no findings for a healthy page', () => {
    const findings = auditPageMetadata([
      page({
        url: 'https://x.com/a',
        title: 'San Clemente Slab Leak Detection',
        meta_description: 'We find and fix slab leaks in San Clemente.',
        h1: 'San Clemente Slab Leak Detection',
        content_word_count: 900,
        schema_types: ['LocalBusiness'],
      }),
    ])
    expect(findings).toEqual([])
  })
})

describe('orphan page detection', () => {
  it('flags a page nothing links to', () => {
    const findings = findOrphanPages(
      [page({ url: 'https://x.com/a' }), page({ url: 'https://x.com/orphan' })],
      [{ from_url: 'https://x.com/a', to_url: 'https://x.com/a', anchor_text: 'self' }]
    )
    expect(findings.some((f) => f.url.includes('/orphan'))).toBe(true)
  })

  it('does not flag a page that has an inbound link', () => {
    const findings = findOrphanPages(
      [page({ url: 'https://x.com/a' }), page({ url: 'https://x.com/linked' })],
      [{ from_url: 'https://x.com/a', to_url: 'https://x.com/linked', anchor_text: 'go' }]
    )
    expect(findings.some((f) => f.url.includes('/linked'))).toBe(false)
  })

  it('does not flag the homepage', () => {
    const findings = findOrphanPages([page({ url: 'https://x.com/' })], [])
    expect(findings).toEqual([])
  })
})

describe('doorway page risk', () => {
  // The detector ignores samples under 200 characters: too little text to judge.
  const filler =
    ' We arrive with acoustic listening equipment and thermal imaging to pinpoint the leak before any ' +
    'demolition begins, then repair it and restore the area the same day. Call today for a prompt visit.'

  it('flags near-identical city pages as doorway risk', () => {
    const findings = findDoorwayRisk([
      page({
        url: 'https://x.com/leak-detection-laguna-niguel',
        title: 'Leak Detection in Laguna Niguel',
        h1: 'Leak Detection in Laguna Niguel',
        content_sample: `We provide leak detection in Laguna Niguel. Our team provides leak detection in Laguna Niguel with fast service.${filler}`,
      }),
      page({
        url: 'https://x.com/leak-detection-laguna-hills',
        title: 'Leak Detection in Laguna Hills',
        h1: 'Leak Detection in Laguna Hills',
        content_sample: `We provide leak detection in Laguna Hills. Our team provides leak detection in Laguna Hills with fast service.${filler}`,
      }),
    ])

    expect(findings.some((f) => f.issueType === 'doorway_page_risk')).toBe(true)
  })

  it('does not flag genuinely different city pages', () => {
    const findings = findDoorwayRisk([
      page({
        url: 'https://x.com/leak-detection-laguna-niguel',
        title: 'Laguna Niguel Leak Detection',
        h1: 'Laguna Niguel Leak Detection',
        content_sample:
          'Laguna Niguel has many homes built in the 1970s with original copper supply lines running under ' +
          'the slab. We locate leaks with acoustic listening equipment and thermal imaging, then repair or ' +
          'reroute the line. Most of our Laguna Niguel work is repiping aged copper after a second failure.',
      }),
      page({
        url: 'https://x.com/leak-detection-san-clemente',
        title: 'San Clemente Leak Detection',
        h1: 'San Clemente Leak Detection',
        content_sample:
          'San Clemente coastal homes face salt air corrosion that attacks older galvanized pipe far faster ' +
          'than inland. We repipe with PEX and replace water service lines from the meter to the house, ' +
          'handling city permits and coastal property access requirements for beachfront addresses.',
      }),
    ])

    expect(findings).toEqual([])
  })

  it('returns no findings when only one city page exists', () => {
    const findings = findDoorwayRisk([
      page({
        url: 'https://x.com/leak-detection-laguna-niguel',
        title: 'Laguna Niguel Leak Detection',
        content_sample: `We serve Laguna Niguel.${filler}`,
      }),
    ])
    expect(findings).toEqual([])
  })
})

describe('internal link recommendations', () => {
  const pages = [
    { url: 'https://x.com/san-clemente-slab-leak', title: 'San Clemente Slab Leak Detection', content_word_count: 900 },
    { url: 'https://x.com/slab-leak-detection', title: 'Slab Leak Detection Services', content_word_count: 1200 },
    { url: 'https://x.com/san-clemente', title: 'San Clemente Plumber', content_word_count: 700 },
    { url: 'https://x.com/unrelated', title: 'Privacy Policy', content_word_count: 300 },
  ]

  it('recommends relevant service and city links for a market page', () => {
    const recommendations = recommendInternalLinks({
      marketPageUrl: 'https://x.com/san-clemente-slab-leak',
      locationName: 'San Clemente',
      serviceName: 'Slab Leak Detection',
      pages,
      existingLinks: [],
    })

    const targets = recommendations.map((r) => r.toUrl)
    expect(targets).toContain('https://x.com/slab-leak-detection')
    expect(targets).toContain('https://x.com/san-clemente')
    // Privacy policy is not a relevant authority target.
    expect(targets).not.toContain('https://x.com/unrelated')
  })

  it('does not re-recommend a link that already exists', () => {
    const existingLinks: LinkEdge[] = [
      { from_url: 'https://x.com/san-clemente-slab-leak', to_url: 'https://x.com/slab-leak-detection', anchor_text: 'slab leaks' },
    ]

    const recommendations = recommendInternalLinks({
      marketPageUrl: 'https://x.com/san-clemente-slab-leak',
      locationName: 'San Clemente',
      serviceName: 'Slab Leak Detection',
      pages,
      existingLinks,
    })

    expect(recommendations.map((r) => r.toUrl)).not.toContain('https://x.com/slab-leak-detection')
  })

  it('never recommends linking a page to itself', () => {
    const recommendations = recommendInternalLinks({
      marketPageUrl: 'https://x.com/san-clemente-slab-leak',
      locationName: 'San Clemente',
      serviceName: 'Slab Leak Detection',
      pages,
      existingLinks: [],
    })
    expect(recommendations.map((r) => r.toUrl)).not.toContain('https://x.com/san-clemente-slab-leak')
  })
})

describe('data quality: prohibited content', () => {
  it('flags an empty stored response', () => {
    const issues = findProhibitedPatterns([{ id: 'r1', raw_response_text: '' }])
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].severity).toBe('high')
  })

  it('flags stored placeholder text', () => {
    const issues = findProhibitedPatterns([
      { id: 'r1', raw_response_text: 'PLACEHOLDER ANSWER TEXT' },
      { id: 'r2', raw_response_text: 'Lorem ipsum dolor sit amet' },
    ])
    expect(issues.length).toBe(2)
  })

  it('accepts a genuine provider answer', () => {
    const issues = findProhibitedPatterns([
      {
        id: 'r1',
        raw_response_text:
          '1. Straight Flush Plumbing & Leak Detection - specializes in slab leak detection in San Clemente.',
      },
    ])
    expect(issues).toEqual([])
  })
})

describe('data quality: duplicates and urls', () => {
  it('detects duplicate competitors sharing a website', () => {
    const issues = findDuplicateCompetitors([
      {
        id: 'c1',
        name: 'Coastline Plumbing',
        normalized_name: 'coastline plumbing',
        website: 'https://www.coastlineplumbing.com',
      },
      {
        id: 'c2',
        name: 'Coastline Plumbing Inc',
        normalized_name: 'coastline plumbing inc',
        website: 'https://coastlineplumbing.com/',
      },
    ])
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].issueType).toBe('duplicate_competitor')
  })

  it('does not flag distinct competitors', () => {
    const issues = findDuplicateCompetitors([
      {
        id: 'c1',
        name: 'Coastline Plumbing',
        normalized_name: 'coastline plumbing',
        website: 'https://coastlineplumbing.com',
      },
      {
        id: 'c2',
        name: 'Harbor Plumbing',
        normalized_name: 'harbor plumbing',
        website: 'https://harborplumbing.com',
      },
    ])
    expect(issues).toEqual([])
  })

  it('flags a malformed url', () => {
    const issues = findMalformedUrls([{ id: 'p1', url: 'not-a-url' }])
    expect(issues.length).toBeGreaterThan(0)
  })

  it('does not flag a well-formed url', () => {
    const issues = findMalformedUrls([{ id: 'p1', url: 'https://straightflushplumbingoc.com/services' }])
    expect(issues).toEqual([])
  })
})