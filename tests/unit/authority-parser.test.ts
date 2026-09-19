/**
 * AI Authority Engine -- response parser tests.
 *
 * The parser is the component that turns a provider's prose into every number
 * on the dashboard. A silent regression here does not throw: it produces
 * plausible but wrong visibility metrics, which is the most dangerous kind of
 * failure in a measurement system. These tests pin the behaviour that matters.
 */

import { describe, it, expect } from 'vitest'
import type { ParserInput } from '@/lib/authority/response-parser'
import {
  classifySourceDomain,
  domainOf,
  isRecommendedLine,
  isSubjectCited,
  normalizeBusinessName,
  parseResponse,
  splitIntoUnits,
} from '@/lib/authority/response-parser'

function answer(
  text: string,
  citations: Array<{ url: string; domain: string; title?: string }> = []
): ParserInput {
  return { text, citations, query: 'test query' }
}

const CONTEXT = {
  subjectName: 'Straight Flush Plumbing & Leak Detection',
  subjectDomains: ['straightflushplumbingoc.com'],
  knownLocations: ['San Clemente', 'Dana Point', 'Laguna Niguel'],
  knownServices: ['Leak Detection', 'Slab Leak Detection', 'Whole-House Repiping'],
  knownCompetitors: ['Coastline Plumbing'],
}

describe('splitIntoUnits', () => {
  it('splits numbered lists into one unit per business', () => {
    const units = splitIntoUnits(
      '1. Coastline Plumbing - specializes in slab leaks\n2. Straight Flush Plumbing & Leak Detection - leak detection\n3. Harbor Plumbing'
    )
    expect(units.length).toBeGreaterThanOrEqual(3)
  })

  it('handles blank input', () => {
    expect(splitIntoUnits('')).toEqual([])
  })
})

describe('domainOf', () => {
  it('strips www and lowercases', () => {
    expect(domainOf('https://WWW.Example.com/some/path')).toBe('example.com')
  })

  it('returns empty string for a malformed url rather than throwing', () => {
    expect(domainOf('not a url')).toBe('')
    expect(domainOf('')).toBe('')
  })
})

describe('classifySourceDomain', () => {
  it('marks the subject domain as first party', () => {
    const result = classifySourceDomain('straightflushplumbingoc.com', ['straightflushplumbingoc.com'], [])
    expect(result.isFirstParty).toBe(true)
    expect(result.sourceType).toBe('company_website')
  })

  it('recognises subdomains of the subject', () => {
    expect(classifySourceDomain('blog.straightflushplumbingoc.com', ['straightflushplumbingoc.com'], []).isFirstParty).toBe(true)
  })

  it('does not mis-classify an unrelated domain as first party', () => {
    const result = classifySourceDomain('yelp.com', ['straightflushplumbingoc.com'], [])
    expect(result.isFirstParty).toBe(false)
  })

  it('does not treat a lookalike suffix as the subject domain', () => {
    // "evil-straightflushplumbingoc.com" ends with the subject string only in a
    // way a naive substring check would accept; the dot-boundary check must not.
    const result = classifySourceDomain('evil-straightflushplumbingoc.com', ['straightflushplumbingoc.com'], [])
    expect(result.isFirstParty).toBe(false)
  })
})

describe('normalizeBusinessName', () => {
  it('collapses punctuation, case and legal suffixes', () => {
    const a = normalizeBusinessName('Straight Flush Plumbing & Leak Detection')
    const b = normalizeBusinessName('straight flush plumbing and leak detection inc.')
    expect(a).toBe(b)
  })
})

describe('isRecommendedLine', () => {
  it('detects recommendation language', () => {
    expect(isRecommendedLine('I would recommend Straight Flush for slab leaks.')).toBe(true)
    expect(isRecommendedLine('The best option is Straight Flush Plumbing.')).toBe(true)
    expect(isRecommendedLine('For slab leaks, the top choice is Straight Flush.')).toBe(true)
  })

  it('does not flag a purely descriptive line', () => {
    expect(isRecommendedLine('The company was founded in 2010.')).toBe(false)
  })

  it('does not count a negated recommendation as a recommendation', () => {
    // "would not recommend" contains the substring "would recommend". Counting
    // it as a recommendation would invert the metric it feeds.
    expect(isRecommendedLine('I would not recommend Straight Flush for slab leaks.')).toBe(false)
    expect(isRecommendedLine('We do not recommend this company.')).toBe(false)
    expect(isRecommendedLine('Avoid this company; they are not recommended.')).toBe(false)
  })

  it('still detects a recommendation when a negation appears elsewhere', () => {
    // The negation guard must be local: an unrelated "no" must not mask a real
    // recommendation.
    expect(isRecommendedLine('No other company comes close; I recommend Straight Flush.')).toBe(true)
  })
})

describe('parseResponse', () => {
  it('ranks the subject correctly in a numbered list', () => {
    const parsed = parseResponse(
      answer(
        [
          '1. Coastline Plumbing - a local option for slab leaks.',
          '2. Straight Flush Plumbing & Leak Detection - specializes in leak detection.',
          '3. Harbor Plumbing Services - general plumbing.',
        ].join('\n')
      ),
      CONTEXT
    )

    expect(parsed.subjectMentioned).toBe(true)
    expect(parsed.subjectPosition).toBe(2)
    expect(parsed.businesses.length).toBeGreaterThanOrEqual(3)
  })

  it('reports a null position when the subject is absent, not zero', () => {
    const parsed = parseResponse(
      answer(
        ['1. Coastline Plumbing - slab leak specialist.', '2. Harbor Plumbing Services - general plumbing.'].join('\n')
      ),
      CONTEXT
    )

    expect(parsed.subjectMentioned).toBe(false)
    // null, never 0: 0 would be treated as "ranked first" by a careless consumer.
    expect(parsed.subjectPosition).toBeNull()
  })

  it('sets a low confidence and a note for an empty answer', () => {
    const parsed = parseResponse(answer(''), CONTEXT)
    expect(parsed.subjectMentioned).toBe(false)
    expect(parsed.businesses).toEqual([])
    expect(parsed.confidence).toBeLessThanOrEqual(0.2)
    expect(parsed.notes.length).toBeGreaterThan(0)
  })

  it('captures citations with domain and source type', () => {
    // Citations arrive as STRUCTURED provider output, not scraped from prose.
    // Provider APIs return their own citation array, and it is authoritative
    // about what the answer actually sourced.
    const parsed = parseResponse(
      answer(
        'Straight Flush Plumbing & Leak Detection is recommended for leak detection in San Clemente.',
        [
          { url: 'https://straightflushplumbingoc.com/san-clemente-leak-detection', domain: 'straightflushplumbingoc.com' },
          { url: 'https://www.yelp.com/biz/straight-flush-plumbing', domain: 'yelp.com' },
        ]
      ),
      CONTEXT
    )

    expect(parsed.citations.length).toBeGreaterThanOrEqual(2)

    const own = parsed.citations.find((c) => c.domain === 'straightflushplumbingoc.com')
    expect(own).toBeDefined()
    // First-party status is derived at storage time from the domain, not stored
    // on the parsed citation, so classify it the same way the runner does.
    expect(classifySourceDomain(own!.domain, CONTEXT.subjectDomains, []).isFirstParty).toBe(true)

    const thirdParty = parsed.citations.find((c) => c.domain === 'yelp.com')
    expect(thirdParty).toBeDefined()
    expect(classifySourceDomain(thirdParty!.domain, CONTEXT.subjectDomains, []).isFirstParty).toBe(false)
  })

  it('marks the subject as cited only when a first-party url appears', () => {
    const cited = parseResponse(
      answer('Straight Flush Plumbing & Leak Detection is great.', [
        { url: 'https://straightflushplumbingoc.com/services', domain: 'straightflushplumbingoc.com' },
      ]),
      CONTEXT
    )
    expect(cited.subjectMentioned).toBe(true)
    expect(cited.subjectCited).toBe(true)

    // Mentioned in the prose but sourced only to a third party: mentioned, not cited.
    const mentionedOnly = parseResponse(
      answer('Straight Flush Plumbing & Leak Detection is great.', [
        { url: 'https://yelp.com/biz/straight-flush-plumbing', domain: 'yelp.com' },
      ]),
      CONTEXT
    )
    expect(mentionedOnly.subjectMentioned).toBe(true)
    expect(mentionedOnly.subjectCited).toBe(false)
  })

  it('records a parser version on every result', () => {
    const parsed = parseResponse(
      answer('Straight Flush Plumbing & Leak Detection is in San Clemente.'),
      CONTEXT
    )
    expect(parsed.parserVersion).toBeTruthy()
  })

  it('is deterministic for the same input', () => {
    const input = answer('1. Straight Flush Plumbing & Leak Detection\n2. Coastline Plumbing')
    const a = parseResponse(input, CONTEXT)
    const b = parseResponse(input, CONTEXT)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('flags competitor mention without inventing data', () => {
    const parsed = parseResponse(
      answer('1. Coastline Plumbing - slab leak specialists in San Clemente.'),
      CONTEXT
    )
    const competitor = parsed.businesses.find((b) =>
      b.name.toLowerCase().includes('coastline')
    )
    expect(competitor).toBeDefined()
  })
})

describe('isSubjectCited', () => {
  it('requires a first-party domain, not merely a mention', () => {
    const citations = [
      { url: 'https://yelp.com/biz/x', domain: 'yelp.com', title: null, businessName: null, position: 1 },
    ]

    expect(isSubjectCited(citations, ['straightflushplumbingoc.com'])).toBe(false)
    // The same citation structure IS a citation of the subject when it is the
    // subject's own domain.
    expect(isSubjectCited(citations, ['yelp.com'])).toBe(true)
  })

  it('returns false for an empty citation set', () => {
    expect(isSubjectCited([], ['straightflushplumbingoc.com'])).toBe(false)
  })
})