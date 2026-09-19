/**
 * AI Authority Engine -- parse service.
 *
 * Wraps the pure response parser with the work that needs context: classifying
 * each citing domain as first-party, competitor, or a known source type, and
 * producing the exact row shapes the store writes.
 *
 * Kept separate from the parser so the parser stays a pure function (easy to
 * test, easy to version) while this layer owns the classification policy.
 */

import { classifySourceDomain, domainOf, parseResponse, type ParserContext } from './response-parser'
import type { SourceType } from './types'

export interface AuthorityCiteRowShape {
  response_id: string
  run_id: string
  engine_id: string
  market_id: string | null
  source_id: string | null
  url: string
  domain: string
  source_type: SourceType
  cited_business_name: string | null
  is_first_party: boolean
  citation_position: number | null
}

export interface ParseContextInput {
  subjectName: string
  subjectDomains: string[]
  competitorDomains?: string[]
  knownLocations: string[]
  knownServices: string[]
  knownCompetitors?: string[]
}

export interface ParseInput {
  text: string
  citations: Array<{ url: string; title?: string; domain: string }>
  query: string
  declaredLocation?: string | null
  declaredService?: string | null
  context: ParseContextInput
}

export interface ParseOutcome {
  parsed: ReturnType<typeof parseResponse>
  /** Citation rows ready for insertion, domain-classified. */
  citations: AuthorityCiteRowShape[]
}

/**
 * Parse a response and prepare its citation rows.
 *
 * Citation classification order matters:
 *   1. subject's own domains -> company_website (first party)
 *   2. known competitor domains -> competitor_website
 *   3. curated known domains and pattern hints
 *   4. other
 *
 * A domain that appears in both the subject list and the competitor list is
 * treated as the subject's, because a business's own site is never a competitor
 * citation even if a competitor is also hosted somewhere similar.
 */
export function buildParsedResponse(input: ParseInput): ParseOutcome {
  const parserContext: ParserContext = {
    subjectName: input.context.subjectName,
    subjectDomains: input.context.subjectDomains,
    knownLocations: input.context.knownLocations,
    knownServices: input.context.knownServices,
    knownCompetitors: input.context.knownCompetitors,
  }

  const parsed = parseResponse(
    {
      text: input.text,
      citations: input.citations,
      query: input.query,
      declaredLocation: input.declaredLocation ?? null,
      declaredService: input.declaredService ?? null,
    },
    parserContext
  )

  const citations: AuthorityCiteRowShape[] = parsed.citations.map((citation, index) => {
    const domain = citation.domain || domainOf(citation.url)
    const classification = classifySourceDomain(
      domain,
      input.context.subjectDomains,
      input.context.competitorDomains ?? []
    )

    return {
      response_id: '',
      run_id: '',
      engine_id: '',
      market_id: null,
      source_id: null,
      url: citation.url.slice(0, 2000),
      domain,
      source_type: classification.sourceType,
      cited_business_name: null,
      is_first_party: classification.isFirstParty,
      citation_position: citation.position || index + 1,
    }
  })

  return { parsed, citations }
}

/**
 * Attach the owning response/run/engine/market ids to prepared citation rows.
 * Kept separate so the pure classification step has no knowledge of persistence.
 */
export function attachCitationOwnership(
  citations: AuthorityCiteRowShape[],
  ownership: {
    responseId: string
    runId: string
    engineId: string
    marketId: string | null
  }
): AuthorityCiteRowShape[] {
  return citations.map((citation) => ({
    ...citation,
    response_id: ownership.responseId,
    run_id: ownership.runId,
    engine_id: ownership.engineId,
    market_id: ownership.marketId,
  }))
}