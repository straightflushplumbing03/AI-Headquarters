/**
 * AI Authority Engine -- opportunity detection and recommendation generation.
 *
 * This is the "what should Business Brain do next" layer. It reads the scored
 * state of each market, derives concrete explainable opportunities, ranks them,
 * and produces recommendations whose steps route through the EXISTING approval
 * machine.
 *
 * APPROVAL ROUTING (the part that must not be got wrong)
 *
 * The engine is autonomous in ANALYSIS and restrained in ACTION:
 *
 *   GREEN  (analysis / internal plans)  -> recorded, no external effect.
 *   YELLOW (customer-facing content)    -> an `approval_requests` row is created
 *                                          and nothing happens until a human
 *                                          with owner/admin role approves it.
 *   RED    (money, identity, legal)     -> never auto-executed, never auto-
 *                                          requested as merely "yellow"; it is
 *                                          surfaced for explicit human handling.
 *
 * RED items are deliberately NOT turned into autonomous_actions, because the
 * execution engine's risk gate would reject critical risk anyway, and creating
 * an action that can never run would be misleading.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  approvalClassFor,
  computeEvidenceAvailability,
  computeOpportunityScore,
  computeProbabilityOfImprovement,
  normalizeCustomerValue,
  priorityFromScore,
} from './opportunity-engine'
import { generateRecommendation } from './recommendation-engine'
import { AUTHORITY_SCORE_VERSION } from './types'
import type { AuthorityStore } from './store'
import type {
  ApprovalClass,
  MarketMetrics,
  OpportunityCategory,
  OpportunityScoreComponents,
  RecommendationAction,
} from './types'

export interface MarketContext {
  marketId: string
  locationName: string
  serviceName: string
  locationId: string
  serviceId: string
  serviceValueEstimate: number | null
  metrics: MarketMetrics
  responseCount: number
  mentionCount: number
  citationCount: number
  firstPartyCitationCount: number
  distinctCompetitors: number
  evidenceTotal: number
  verifiedEvidence: number
  publishedEvidence: number
  hasPage: boolean
  pageId: string | null
  pageHasSchema: boolean
  missingInternalLinks: number
  gapDomains: string[]
  visibilityChange: number | null
}

/** Human-readable category titles used as the opportunity's stable identity. */
const CATEGORY_TITLES: Record<OpportunityCategory, string> = {
  authority_gap: 'Improve overall authority',
  content_gap: 'Strengthen content coverage',
  citation_gap: 'Diversify citation sources',
  evidence_gap: 'Collect and verify first-party evidence',
  technical_seo: 'Resolve technical SEO findings',
  internal_linking: 'Improve internal linking',
  competitor_pressure: 'Review competitor pressure',
  expansion: 'Evaluate market expansion',
}

export interface DetectedOpportunity {
  category: OpportunityCategory
  title: string
  what: string
  why: string
  evidence: Record<string, unknown>
  impact: string
  action: string
  risk: string
  measurement: string
  scores: OpportunityScoreComponents
  approvalClass: ApprovalClass
  priority: 'critical' | 'high' | 'medium' | 'low' | 'monitor'
}

/**
 * Derive opportunities for one market. Pure: all inputs come from `context`, so
 * the detection logic is unit testable and its reasoning is reproducible.
 */
export function detectOpportunities(context: MarketContext): DetectedOpportunity[] {
  const opportunities: DetectedOpportunity[] = []
  const { metrics } = context

  const customerValue = normalizeCustomerValue(context.serviceValueEstimate, null)
  const evidenceAvailability = computeEvidenceAvailability({
    totalEvidence: context.evidenceTotal,
    publishedEvidence: context.publishedEvidence,
    verifiedEvidence: context.verifiedEvidence,
    hasPage: context.hasPage,
  })
  const probabilityOfImprovement = computeProbabilityOfImprovement({
    responseCount: context.responseCount,
    currentVisibility: metrics.internalVisibilityScore,
    hasPage: context.hasPage,
    hasEvidence: context.verifiedEvidence > 0,
  })

  const scoreFor = (): OpportunityScoreComponents =>
    computeOpportunityScore({
      metrics,
      customerValueNormalized: customerValue,
      evidenceAvailability,
      probabilityOfImprovement,
    })

  const commonEvidence = {
    responseCount: context.responseCount,
    mentionCount: context.mentionCount,
    citationCount: context.citationCount,
    firstPartyCitationCount: context.firstPartyCitationCount,
    internalVisibilityScore: metrics.internalVisibilityScore,
    internalMentionRate: metrics.internalMentionRate,
    internalAuthorityScore: metrics.internalAuthorityScore,
    competitorPressure: metrics.competitorPressure,
    distinctCompetitors: context.distinctCompetitors,
    evidenceTotal: context.evidenceTotal,
    verifiedEvidence: context.verifiedEvidence,
    publishedEvidence: context.publishedEvidence,
    hasPage: context.hasPage,
    scoreVersion: AUTHORITY_SCORE_VERSION,
  }

  // --- Evidence gap: nothing publishable to build on. ---------------------
  if (context.evidenceTotal === 0 || context.verifiedEvidence === 0) {
    opportunities.push({
      category: 'evidence_gap',
      title: CATEGORY_TITLES.evidence_gap,
      what:
        context.evidenceTotal === 0
          ? `No first-party evidence is linked to ${context.locationName} / ${context.serviceName}.`
          : `Evidence exists for ${context.locationName} / ${context.serviceName} but none of it is verified.`,
      why:
        'Content and recommendations built without verifiable evidence cannot be published honestly, and ' +
        'unverified claims are exactly what the guardrails prohibit.',
      evidence: commonEvidence,
      impact: 'Unblocks every content and citation action for this market.',
      action: 'Link real completed work and verify it. Nothing may be invented to fill this gap.',
      risk: 'Low. This step changes nothing externally.',
      measurement: 'Verified evidence count for the market, and subsequent content actions unblocked.',
      scores: scoreFor(),
      approvalClass: 'green',
      priority: 'high',
    })
  }

  // --- Visibility gap with an existing page but weak presence. ------------
  if (context.responseCount > 0 && metrics.internalVisibilityScore < 50) {
    opportunities.push({
      category: context.hasPage ? 'content_gap' : 'authority_gap',
      title: context.hasPage ? CATEGORY_TITLES.content_gap : CATEGORY_TITLES.authority_gap,
      what: context.hasPage
        ? `${context.locationName} / ${context.serviceName} has a page but weak AI-search visibility.`
        : `${context.locationName} / ${context.serviceName} has no mapped page.`,
      why:
        `Internal visibility is ${metrics.internalVisibilityScore}/100 across ${context.responseCount} ` +
        `collected answer(s): ${context.mentionCount} mention(s), ${context.citationCount} citation(s).`,
      evidence: commonEvidence,
      impact:
        'This market is one of the twenty the business is actively targeting, so improving it has ' +
        'direct commercial relevance.',
      action: context.hasPage
        ? 'Create a brief grounded in verified evidence, then update the page after approval.'
        : 'Decide whether this market warrants a genuinely distinct page, then brief it.',
      risk:
        'Medium. Publishing requires approval, and near-duplicate city pages are prohibited, so the ' +
        'page must be genuinely specific.',
      measurement: 'Internal visibility, mention rate, and first-mention rate against this baseline.',
      scores: scoreFor(),
      approvalClass: 'yellow',
      priority: priorityFromScore(scoreFor().score),
    })
  }

  // --- Citation concentration: over-reliant on our own site. --------------
  if (context.citationCount > 0 && metrics.internalWebsiteCitationRate >= 60) {
    opportunities.push({
      category: 'citation_gap',
      title: CATEGORY_TITLES.citation_gap,
      what:
        `${metrics.internalWebsiteCitationRate}% of citations for ${context.locationName} / ` +
        `${context.serviceName} point at the business's own site.`,
      why:
        'Independent corroboration is stronger evidence than a business describing itself, and it is ' +
        'less fragile if our own site changes.',
      evidence: { ...commonEvidence, gapDomains: context.gapDomains },
      impact: 'Broadens the evidence base an AI answer can draw on when recommending the business.',
      action:
        'Evaluate legitimate eligibility for relevant third-party source types. No paid links, no mass ' +
        'submissions, no fabricated coverage.',
      risk: 'Medium. Any external submission requires approval and must be genuinely deserved.',
      measurement: 'Distinct third-party source domains citing this market.',
      scores: scoreFor(),
      approvalClass: 'yellow',
      priority: 'medium',
    })
  }

  // --- Competitor pressure. ------------------------------------------------
  if (context.distinctCompetitors >= 3) {
    opportunities.push({
      category: 'competitor_pressure',
      title: CATEGORY_TITLES.competitor_pressure,
      what: `${context.distinctCompetitors} distinct competitors appear in answers for this market.`,
      why:
        `Competitor pressure is ${metrics.competitorPressure}/100 while our internal visibility is ` +
        `${metrics.internalVisibilityScore}/100.`,
      evidence: commonEvidence,
      impact: 'Understanding why competitors are surfaced shows what evidence this business lacks.',
      action: 'Review competitor cards and their cited source types. Do not target competitors directly.',
      risk: 'Low. Analysis only.',
      measurement: 'Change in our mention rate relative to observed competitor mentions.',
      scores: scoreFor(),
      approvalClass: 'green',
      priority: 'medium',
    })
  }

  // --- Internal linking. ---------------------------------------------------
  if (context.missingInternalLinks > 0) {
    opportunities.push({
      category: 'internal_linking',
      title: CATEGORY_TITLES.internal_linking,
      what: `${context.missingInternalLinks} relevant internal link(s) are missing for this market.`,
      why:
        'Internal links make the relationship between the city page, the service page, and supporting ' +
        'evidence explicit, for both users and crawlers.',
      evidence: { ...commonEvidence, missingInternalLinks: context.missingInternalLinks },
      impact: 'Low-risk structural improvement to how this market connects to the rest of the site.',
      action: 'Review and apply the generated internal-link plan.',
      risk: 'Low. Site structure only, easily reverted.',
      measurement: 'Inbound internal links to the market page.',
      scores: scoreFor(),
      approvalClass: 'green',
      priority: 'low',
    })
  }

  // --- Technical findings on the mapped page. -----------------------------
  if (context.hasPage && !context.pageHasSchema) {
    opportunities.push({
      category: 'technical_seo',
      title: CATEGORY_TITLES.technical_seo,
      what: `The mapped page for ${context.locationName} / ${context.serviceName} has no structured data.`,
      why: 'Structured data helps machines understand what the page is about and what the business offers.',
      evidence: commonEvidence,
      impact: 'Potentially improves how the page is interpreted and surfaced.',
      action:
        'Review whether appropriate, truthful schema applies to content that is actually visible. ' +
        'Misleading markup is prohibited.',
      risk: 'Medium. Incorrect schema is worse than no schema.',
      measurement: 'Schema presence and validity on the page, plus any subsequent visibility change.',
      scores: scoreFor(),
      approvalClass: 'yellow',
      priority: 'low',
    })
  }

  // --- Visibility decline. -------------------------------------------------
  if (context.visibilityChange !== null && context.visibilityChange <= -10) {
    opportunities.push({
      category: 'authority_gap',
      title: 'Investigate visibility decline',
      what: `Internal visibility for this market fell by ${Math.abs(context.visibilityChange)} points.`,
      why:
        'A material drop warrants investigation before any other investment in this market. The cause ' +
        'is not established by the measurement alone.',
      evidence: { ...commonEvidence, visibilityChange: context.visibilityChange },
      impact: 'Prevents further loss if the decline continues.',
      action: 'Review recent answers for this market and compare cited sources against the previous window.',
      risk: 'Low. Investigation only.',
      measurement: 'Whether visibility recovers over the next measurement window.',
      scores: scoreFor(),
      approvalClass: 'green',
      priority: 'high',
    })
  }

  return opportunities.sort((a, b) => b.scores.score - a.scores.score)
}

export interface GenerationSummary {
  marketsEvaluated: number
  opportunitiesUpserted: number
  recommendationsCreated: number
  actionsCreated: number
  approvalsRequested: number
  redFlagged: number
}

/**
 * Recommendation orchestrator.
 *
 * Reads scored markets, detects opportunities, persists them with full
 * component scores, and writes the ordered steps. Customer-facing steps create
 * approval requests through the existing machine; RED steps are recorded and
 * surfaced but never scheduled for execution.
 */
export class AuthorityRecommendationEngine {
  constructor(
    private supabase: SupabaseClient,
    private store: AuthorityStore
  ) {}

  async generate(params: {
    organizationId: string
    contexts: MarketContext[]
    limit?: number
  }): Promise<GenerationSummary> {
    const organizationId = params.organizationId
    const summary: GenerationSummary = {
      marketsEvaluated: params.contexts.length,
      opportunitiesUpserted: 0,
      recommendationsCreated: 0,
      actionsCreated: 0,
      approvalsRequested: 0,
      redFlagged: 0,
    }

    let remaining = params.limit ?? Number.MAX_SAFE_INTEGER

    for (const context of params.contexts) {
      if (remaining <= 0) break

      const detected = detectOpportunities(context)

      for (const opportunity of detected) {
        if (remaining <= 0) break

        const opportunityId = await this.store.upsertOpportunity({
          organization_id: organizationId,
          market_id: context.marketId,
          title: opportunity.title,
          category: opportunity.category,
          what: opportunity.what,
          why: opportunity.why,
          evidence: opportunity.evidence,
          impact: opportunity.impact,
          action: opportunity.action,
          risk: opportunity.risk,
          measurement: opportunity.measurement,
          visibility_gap: opportunity.scores.visibilityGap,
          customer_value: opportunity.scores.customerValue,
          competitive_opportunity: opportunity.scores.competitiveOpportunity,
          evidence_availability: opportunity.scores.evidenceAvailability,
          probability_of_improvement: opportunity.scores.probabilityOfImprovement,
          opportunity_score: opportunity.scores.score,
          score_explanation: opportunity.scores.explanation,
          score_version: AUTHORITY_SCORE_VERSION,
          approval_class: opportunity.approvalClass,
          approval_required: opportunity.approvalClass !== 'green',
          status: 'new',
        })

        if (!opportunityId) continue
        summary.opportunitiesUpserted += 1

        const recommendation = generateRecommendation({
          opportunityId,
          marketId: context.marketId,
          category: opportunity.category,
          title: opportunity.title,
          locationName: context.locationName,
          serviceName: context.serviceName,
          scores: opportunity.scores,
          metrics: context.metrics,
          facts: {
            responseCount: context.responseCount,
            mentionCount: context.mentionCount,
            citationCount: context.citationCount,
            firstPartyCitationCount: context.firstPartyCitationCount,
            distinctCompetitors: context.distinctCompetitors,
            verifiedEvidence: context.verifiedEvidence,
            publishedEvidence: context.publishedEvidence,
            hasPage: context.hasPage,
            hasSchema: context.pageHasSchema,
            missingInternalLinks: context.missingInternalLinks,
            gapDomains: context.gapDomains,
          },
        })

        // Reuse the pre-existing phase-5 recommendations table.
        const recommendationId = await this.store.insertRecommendation({
          organization_id: organizationId,
          recommendation_title: recommendation.title,
          description: opportunity.what,
          reasoning: recommendation.reasoning,
          priority: recommendation.priority,
          opportunity_score: opportunity.scores.score,
          confidence: recommendation.confidence,
          supporting_evidence: opportunity.evidence,
          recommended_by_system: 'ai_authority_engine',
          recommendation_basis: opportunity.scores.explanation,
          approval_required: recommendation.approvalRequired,
          approval_status: 'pending',
          execution_status: 'not_started',
          expected_outcomes: [opportunity.measurement],
        })

        if (recommendationId) summary.recommendationsCreated += 1

        for (const action of recommendation.actions) {
          const actionId = await this.store.upsertRecommendationAction({
            organization_id: organizationId,
            opportunity_id: opportunityId,
            market_id: context.marketId,
            recommendation_id: recommendationId,
            step_order: action.stepOrder,
            title: action.title,
            description: action.description,
            action_type: action.actionType,
            approval_class: action.approvalClass,
            status: action.approvalClass === 'green' ? 'proposed' : 'awaiting_approval',
          })

          if (!actionId) continue
          summary.actionsCreated += 1

          if (action.approvalClass === 'red') {
            summary.redFlagged += 1
            continue
          }

          if (action.approvalClass === 'yellow') {
            const requested = await this.requestApproval({
              organizationId,
              marketId: context.marketId,
              locationName: context.locationName,
              serviceName: context.serviceName,
              recommendationActionId: actionId,
              action,
              reasoning: recommendation.reasoning,
              confidence: recommendation.confidence,
            })
            if (requested) summary.approvalsRequested += 1
          }
        }

        await this.store.updateOpportunity(organizationId, opportunityId, {
          status: 'recommended',
        })

        remaining -= 1
      }
    }

    return summary
  }

  /**
   * Route a yellow step through the EXISTING approval machine.
   *
   * Creates the decision + action + approval_requests triple so the current
   * approval UI and REST endpoints work unchanged. Returns false when any part
   * fails, so accounting stays honest.
   */
  private async requestApproval(params: {
    organizationId: string
    marketId: string
    locationName: string
    serviceName: string
    recommendationActionId: string
    action: RecommendationAction
    reasoning: string
    confidence: number
  }): Promise<boolean> {
    const organizationId = params.organizationId
    const idempotencyKey = `authority-action:${params.recommendationActionId}`

    // 1. Decision record (explainable, reuses the phase-6 table).
    const { data: decision, error: decisionError } = await this.supabase
      .from('autonomous_decisions')
      .insert({
        organization_id: organizationId,
        decision_type: 'authority_improvement',
        title: params.action.title.slice(0, 300),
        description: params.action.description.slice(0, 2000),
        reasoning: params.reasoning.slice(0, 4000),
        supporting_evidence: {
          marketId: params.marketId,
          locationName: params.locationName,
          serviceName: params.serviceName,
          recommendationActionId: params.recommendationActionId,
        },
        confidence_score: params.confidence,
        confidence_level: params.confidence >= 75 ? 'high' : params.confidence >= 50 ? 'medium' : 'low',
        expected_impact_type: 'lead',
        risk_level: 'medium',
        risk_description:
          'Customer-facing content change. Requires explicit human approval before publication.',
        recommended_action: params.action.description.slice(0, 1000),
        approval_level: 'approval_required',
      })
      .select('id')
      .single()

    if (decisionError || !decision) {
      console.error(`[authority] decision insert failed: ${decisionError?.message}`)
      return false
    }

    // 2. Action record (level_3 => approval required; never critical, because
    //    critical risk can never be auto-approved and creating one that cannot
    //    run would be misleading).
    const { data: action, error: actionError } = await this.supabase
      .from('autonomous_actions')
      .insert({
        organization_id: organizationId,
        decision_id: decision.id,
        action_type: params.action.actionType,
        title: params.action.title.slice(0, 300),
        description: params.action.description.slice(0, 2000),
        payload: {
          marketId: params.marketId,
          recommendationActionId: params.recommendationActionId,
        },
        authorization_level: 'level_3',
        risk_level: 'medium',
        execution_status: 'queued',
        idempotency_key: idempotencyKey,
      })
      .select('id')
      .single()

    if (actionError || !action) {
      console.error(`[authority] action insert failed: ${actionError?.message}`)
      return false
    }

    // 3. Approval request (reuses the existing state machine + expiry sweep).
    const responseDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { error: approvalError } = await this.supabase.from('approval_requests').insert({
      organization_id: organizationId,
      decision_id: decision.id,
      action_id: action.id,
      request_type: 'action',
      title: params.action.title.slice(0, 300),
      description: params.action.description.slice(0, 2000),
      evidence: {
        marketId: params.marketId,
        locationName: params.locationName,
        serviceName: params.serviceName,
      },
      reasoning: params.reasoning.slice(0, 4000),
      expected_impact: 'Improved AI-search visibility for this market, measured internally.',
      risk_assessment:
        'Customer-facing content. Requires owner/admin approval. No automatic publication occurs.',
      ai_recommendation: params.action.description.slice(0, 1000),
      recommendation_confidence: params.confidence,
      approval_status: 'pending',
      response_deadline: responseDeadline,
    })

    if (approvalError) {
      console.error(`[authority] approval request insert failed: ${approvalError.message}`)
      return false
    }

    await this.store.updateRecommendationAction(organizationId, params.recommendationActionId, {
      decision_id: decision.id,
      action_id: action.id,
      status: 'awaiting_approval',
    })

    await this.store.logAudit({
      organizationId,
      userId: null,
      action: 'ai_authority.approval_requested',
      resource: `authority_recommendation_action:${params.recommendationActionId}`,
      details: params.action.title,
      metadata: { decisionId: decision.id, actionId: action.id, marketId: params.marketId },
    })

    return true
  }
}

/** Approval class for a category, re-exported for callers. */
export { approvalClassFor }