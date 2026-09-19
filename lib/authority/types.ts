/**
 * AI Authority Engine -- shared types.
 *
 * Mirrors supabase/migrations/021_ai_authority_engine.sql.
 *
 * NAMING NOTE (important):
 * Every metric this engine computes is a BUSINESS BRAIN INTERNAL METRIC. The
 * `internal_` prefix is intentional and load-bearing. No AI provider publishes
 * a ranking formula, so nothing here may be presented as, or named after, an
 * external platform's ranking. The engine measures observable behaviour
 * (was the business mentioned, where, cited from where, how often) and derives
 * its own scores from that. See docs/ai-authority/AUDIT.md.
 */

export const AUTHORITY_PARSER_VERSION = 'v1'
export const AUTHORITY_SCORE_VERSION = 'v1'

/** Default measurement window for every rolling metric. */
export const DEFAULT_WINDOW_DAYS = 30

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export type LocationTier = 'priority' | 'expansion' | 'archived'
export type ServiceTier = 'priority' | 'supporting' | 'archived'

export type QueryIntent =
  | 'geographic'
  | 'service'
  | 'buyer'
  | 'problem'
  | 'comparison'
  | 'emergency'
  | 'cost'

export type BuyerStage = 'awareness' | 'consideration' | 'decision' | 'retention'

export type ApprovalClass = 'green' | 'yellow' | 'red'

export interface AuthorityLocation {
  id: string
  organization_id: string
  name: string
  slug: string
  state: string | null
  county: string | null
  tier: LocationTier
  is_home_market: boolean
  nearby_location_ids: string[]
  latitude: number | null
  longitude: number | null
  local_context: Record<string, unknown>
  active: boolean
  created_at: string
  updated_at: string
}

export interface AuthorityService {
  id: string
  organization_id: string
  name: string
  slug: string
  tier: ServiceTier
  customer_value_estimate: number | null
  customer_value_basis: string | null
  customer_phrases: string[]
  problem_phrases: string[]
  related_service_ids: string[]
  active: boolean
  created_at: string
  updated_at: string
}

export interface AuthorityMarket {
  id: string
  organization_id: string
  location_id: string
  service_id: string
  active: boolean
  location_name: string
  service_name: string
  primary_page_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Engines and adapters
// ---------------------------------------------------------------------------

export type EngineKey = 'chatgpt' | 'gemini' | 'perplexity' | 'grok' | 'google_ai'

/**
 * Honest statement of whether a surface can be monitored at all.
 *
 * - `supported`            : an authorized API exists and a credential is present
 * - `requires_credential`  : the adapter exists but no credential is configured
 * - `unsupported`          : no authorized programmatic access exists today
 *
 * The engine never invents results for a surface that is not monitorable.
 */
export type EngineCapability = 'supported' | 'requires_credential' | 'unsupported'

export interface AuthorityEngine {
  id: string
  organization_id: string
  key: EngineKey
  display_name: string
  vendor: string | null
  capability: EngineCapability
  credential_env_var: string | null
  default_model: string | null
  adapter_version: string
  enabled: boolean
  daily_query_limit: number | null
  monthly_query_limit: number | null
  last_query_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface AdapterQueryRequest {
  /** The exact natural-language query a customer would type or ask. */
  query: string
  /** City context, used only for adapter-side phrasing when supported. */
  locationName?: string
  /** Service context, used only for adapter-side phrasing when supported. */
  serviceName?: string
  /** Advisory request; the effective value is decided by the adapter. */
  maxTokens?: number
  /** Advisory request; the effective value is decided by the adapter. */
  temperature?: number
}

export interface AdapterCitation {
  url: string
  title?: string
  domain: string
}

export interface AdapterResult {
  ok: boolean
  /** Verbatim response text. Empty string when ok is false. */
  text: string
  model: string | null
  citations: AdapterCitation[]
  latencyMs: number
  tokensInput: number
  tokensOutput: number
  actualCost: number
  /**
   * Populated when ok is false. `skipped: true` distinguishes "we deliberately
   * did not call" (unconfigured / unsupported / budget) from a real failure.
   */
  error?: string
  errorType?: AdapterErrorType
  skipped?: boolean
  skipReason?: string
}

export type AdapterErrorType =
  | 'not_configured'
  | 'unsupported'
  | 'rate_limited'
  | 'timeout'
  | 'authentication_failed'
  | 'invalid_response'
  | 'budget_exceeded'
  | 'unknown_error'

export interface AIEngineAdapter {
  readonly key: EngineKey
  readonly displayName: string
  readonly vendor: string
  readonly credentialEnvVar: string | null
  /** Whether the required credential is present in the environment. */
  isConfigured(): boolean
  /** The strongest capability this adapter can offer in the current process. */
  capability(): EngineCapability
  /** The model this adapter would use, if any. */
  model(): string | null
  executeQuery(request: AdapterQueryRequest): Promise<AdapterResult>
}

// ---------------------------------------------------------------------------
// Queries and runs
// ---------------------------------------------------------------------------

export interface AuthorityQueryTemplate {
  id: string
  organization_id: string
  pattern: string
  intent: QueryIntent
  buyer_stage: BuyerStage | null
  base_importance: number
  season_months: number[] | null
  source: string
  active: boolean
  created_at: string
  updated_at: string
}

export interface AuthorityQuery {
  id: string
  organization_id: string
  raw_text: string
  normalized_text: string
  market_id: string | null
  location_id: string | null
  service_id: string | null
  intent: QueryIntent
  buyer_stage: BuyerStage | null
  template_id: string | null
  source: string
  importance: number
  active: boolean
  first_seen_at: string
  last_run_at: string | null
  run_count: number
  created_at: string
  updated_at: string
}

export type QueryRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface AuthorityQueryRun {
  id: string
  organization_id: string
  query_id: string
  engine_id: string
  market_id: string | null
  run_key: string
  status: QueryRunStatus
  skip_reason: string | null
  error_message: string | null
  attempts: number
  model: string | null
  latency_ms: number | null
  estimated_cost: number
  actual_cost: number
  budget_reservation_id: string | null
  tokens_input: number | null
  tokens_output: number | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

/**
 * A generated query, before persistence. Produced by the query generator and
 * de-duplicated by normalized intent.
 */
export interface GeneratedQuery {
  rawText: string
  normalizedText: string
  intent: QueryIntent
  buyerStage: BuyerStage | null
  importance: number
  templateId: string | null
  marketId: string | null
  locationId: string | null
  serviceId: string | null
  source: 'generated'
}

/** One normalized intent, with every raw phrasing observed for it. */
export interface NormalizedQuery {
  normalizedText: string
  intent: QueryIntent
  rawVariants: string[]
}

// ---------------------------------------------------------------------------
// Responses, mentions, citations
// ---------------------------------------------------------------------------

export interface AuthorityResponse {
  id: string
  organization_id: string
  run_id: string
  query_id: string
  engine_id: string
  market_id: string | null
  engine_key: string
  model: string | null
  captured_at: string
  raw_response_text: string
  location_context: string | null
  service_context: string | null
  business_count: number
  straight_flush_mentioned: boolean
  straight_flush_position: number | null
  straight_flush_cited: boolean
  recommendation_language: string[]
  factual_claims: ParsedFactualClaim[]
  parser_version: string
  parse_confidence: number | null
  parse_notes: string | null
  internal_recommended: boolean
  created_at: string
  updated_at: string
}

export interface AuthorityMention {
  id: string
  organization_id: string
  response_id: string
  run_id: string
  engine_id: string
  market_id: string | null
  position: number
  business_name: string
  normalized_business_name: string
  is_subject: boolean
  competitor_id: string | null
  website: string | null
  services_associated: string[]
  locations_associated: string[]
  is_recommended: boolean
  recommendation_context: string | null
  created_at: string
}

export type SourceType =
  | 'company_website'
  | 'google_business_profile'
  | 'review_platform'
  | 'directory'
  | 'local_publication'
  | 'news'
  | 'trade_organization'
  | 'government'
  | 'social'
  | 'youtube'
  | 'business_association'
  | 'community_site'
  | 'competitor_website'
  | 'other'

export interface AuthoritySource {
  id: string
  organization_id: string
  domain: string
  source_type: SourceType
  is_first_party: boolean
  internal_relevance: number | null
  internal_freshness: number | null
  internal_credibility: number | null
  classification_notes: string | null
  first_seen_at: string
  last_seen_at: string
  created_at: string
  updated_at: string
}

export interface AuthorityCitation {
  id: string
  organization_id: string
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
  created_at: string
}

// ---------------------------------------------------------------------------
// Parsed response structure (the parser's output contract)
// ---------------------------------------------------------------------------

export interface ParsedBusiness {
  name: string
  normalizedName: string
  position: number
  website: string | null
  services: string[]
  locations: string[]
  isRecommended: boolean
  recommendationContext: string | null
  isSubject: boolean
}

export interface ParsedCitation {
  url: string
  domain: string
  title: string | null
  businessName: string | null
  position: number
}

export interface ParsedFactualClaim {
  text: string
  /** Never treated as verified truth; recorded so claims can be reviewed. */
  kind: 'service' | 'location' | 'credential' | 'pricing' | 'availability' | 'other'
}

export interface ParsedResponse {
  parserVersion: string
  businesses: ParsedBusiness[]
  citations: ParsedCitation[]
  locationContext: string | null
  serviceContext: string | null
  subjectMentioned: boolean
  subjectPosition: number | null
  subjectCited: boolean
  subjectRecommended: boolean
  recommendationLanguage: string[]
  factualClaims: ParsedFactualClaim[]
  confidence: number
  notes: string[]
}

// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------

export interface AuthorityCompetitor {
  id: string
  organization_id: string
  name: string
  normalized_name: string
  website: string | null
  phone: string | null
  discovery_source: string
  locations: string[]
  services: string[]
  is_primary: boolean
  watch_enabled: boolean
  first_seen_at: string
  last_seen_at: string
  notes: string | null
  created_at: string
  updated_at: string
}

export interface AuthorityCompetitorSnapshot {
  id: string
  organization_id: string
  competitor_id: string
  snapshot_date: string
  window_days: number
  ai_mention_count: number
  ai_first_position_count: number
  ai_citation_count: number
  ai_response_count: number
  distinct_source_domains: number
  locations_seen: string[]
  services_seen: string[]
  engines_seen: string[]
  top_source_domains: Array<{ domain: string; count: number }>
  internal_share_of_voice: number | null
  metrics: Record<string, unknown>
  created_at: string
}

export type CompetitorChangeType =
  | 'new_page'
  | 'changed_page'
  | 'new_service_page'
  | 'new_city_page'
  | 'new_review'
  | 'new_media'
  | 'new_citation'
  | 'new_mention'
  | 'ai_visibility_increase'
  | 'ai_visibility_decrease'
  | 'search_visibility_change'
  | 'new_competitor'

export interface AuthorityCompetitorChange {
  id: string
  organization_id: string
  competitor_id: string
  market_id: string | null
  change_type: CompetitorChangeType
  significance: 'low' | 'medium' | 'high' | 'critical'
  summary: string
  details: Record<string, unknown>
  warrants_action: boolean
  detected_at: string
  reviewed_at: string | null
  status: 'new' | 'reviewed' | 'acted_on' | 'dismissed'
  created_at: string
}

// ---------------------------------------------------------------------------
// Evidence and entity graph
// ---------------------------------------------------------------------------

export type EvidenceType =
  | 'completed_project'
  | 'leak_detection'
  | 'slab_leak'
  | 'water_line_reroute'
  | 'repipe'
  | 'plumbing_repair'
  | 'before_after'
  | 'customer_review'
  | 'photo'
  | 'video'
  | 'invoice'
  | 'estimate'
  | 'service_record'

export type EvidenceSource =
  | 'manual'
  | 'business_brain_project'
  | 'review_import'
  | 'invoice_import'
  | 'media_upload'

export interface AuthorityEvidence {
  id: string
  organization_id: string
  evidence_type: EvidenceType
  title: string
  description: string | null
  location_id: string | null
  service_id: string | null
  market_id: string | null
  page_id: string | null
  occurred_on: string | null
  city_text: string | null
  neighborhood: string | null
  material: string | null
  problem: string | null
  resolution: string | null
  source: EvidenceSource
  source_record_id: string | null
  media_urls: string[]
  metadata: Record<string, unknown>
  customer_permission_status: 'unknown' | 'granted' | 'denied'
  publish_permission: boolean
  verification_status: 'unverified' | 'verified' | 'rejected'
  verified_by: string | null
  verified_at: string | null
  created_at: string
  updated_at: string
}

export type EvidenceEntityType =
  | 'location'
  | 'service'
  | 'market'
  | 'page'
  | 'project'
  | 'review'
  | 'photo'
  | 'video'
  | 'citation'
  | 'source'
  | 'competitor'

export interface AuthorityEvidenceLink {
  id: string
  organization_id: string
  evidence_id: string
  entity_type: EvidenceEntityType
  entity_id: string
  relation: 'supports' | 'mentions' | 'illustrates' | 'documents' | 'contradicts'
  created_at: string
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export interface AuthorityScore {
  id: string
  organization_id: string
  market_id: string
  measured_at: string
  window_days: number
  response_count: number
  internal_mention_rate: number | null
  internal_first_mention_rate: number | null
  internal_citation_rate: number | null
  internal_website_citation_rate: number | null
  internal_visibility_score: number | null
  evidence_count: number
  published_evidence_count: number
  content_coverage: number | null
  citation_coverage: number | null
  review_coverage: number | null
  project_coverage: number | null
  internal_authority_score: number | null
  competitor_pressure: number | null
  internal_opportunity_score: number | null
  components: Record<string, unknown>
  created_at: string
}

/** Inputs to the scoring model. Every field is an observable count or ratio. */
export interface MarketObservation {
  windowDays: number
  responseCount: number
  mentionCount: number
  firstMentionCount: number
  citationCount: number
  firstPartyCitationCount: number
  competitorMentionTotal: number
  distinctCompetitors: number
  evidenceCount: number
  publishedEvidenceCount: number
  reviewEvidenceCount: number
  projectEvidenceCount: number
  linkedPageCount: number
  pageCountWithSchema: number
  internalLinkInboundCount: number
}

export interface MarketMetrics {
  internalMentionRate: number
  internalFirstMentionRate: number
  internalCitationRate: number
  internalWebsiteCitationRate: number
  internalVisibilityScore: number
  contentCoverage: number
  citationCoverage: number
  reviewCoverage: number
  projectCoverage: number
  internalAuthorityScore: number
  competitorPressure: number
  components: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Opportunities and recommendations
// ---------------------------------------------------------------------------

export type OpportunityCategory =
  | 'authority_gap'
  | 'content_gap'
  | 'citation_gap'
  | 'evidence_gap'
  | 'technical_seo'
  | 'internal_linking'
  | 'competitor_pressure'
  | 'expansion'

export interface OpportunityScoreComponents {
  visibilityGap: number
  customerValue: number
  competitiveOpportunity: number
  evidenceAvailability: number
  probabilityOfImprovement: number
  score: number
  explanation: string
}

export interface AuthorityOpportunity {
  id: string
  organization_id: string
  market_id: string | null
  title: string
  category: OpportunityCategory
  what: string
  why: string
  evidence: Record<string, unknown>
  impact: string | null
  action: string | null
  risk: string | null
  measurement: string | null
  visibility_gap: number | null
  customer_value: number | null
  competitive_opportunity: number | null
  evidence_availability: number | null
  probability_of_improvement: number | null
  opportunity_score: number | null
  score_explanation: string | null
  score_version: string
  approval_class: ApprovalClass
  approval_required: boolean
  status: string
  priority_rank: number | null
  detected_at: string
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface RecommendationAction {
  stepOrder: number
  title: string
  description: string
  actionType: string
  approvalClass: ApprovalClass
}

/** The recommendation engine's output: explanation + concrete ordered steps. */
export interface GeneratedRecommendation {
  opportunityId: string
  marketId: string | null
  title: string
  reasoning: string
  actions: RecommendationAction[]
  priority: 'critical' | 'high' | 'medium' | 'low' | 'monitor'
  confidence: number
  approvalRequired: boolean
}

// ---------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------

export interface AuthorityExperiment {
  id: string
  organization_id: string
  market_id: string | null
  opportunity_id: string | null
  name: string
  hypothesis: string
  change_description: string
  change_type: string
  metric: string
  baseline: Record<string, unknown>
  baseline_captured_at: string | null
  status: 'draft' | 'running' | 'completed' | 'abandoned'
  started_at: string | null
  ended_at: string | null
  planned_duration_days: number
  result: Record<string, unknown>
  result_summary: string | null
  confidence: number | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface AuthorityExperimentResult {
  id: string
  organization_id: string
  experiment_id: string
  measured_at: string
  phase: 'before' | 'during' | 'after'
  metrics: Record<string, unknown>
  notes: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Cost control
// ---------------------------------------------------------------------------

export interface AuthorityBudget {
  organization_id: string
  daily_query_limit: number
  monthly_query_limit: number
  per_query_cost_ceiling: number
  monthly_cost_ceiling: number
  min_importance_when_constrained: number
  paused: boolean
  pause_reason: string | null
  created_at: string
  updated_at: string
}

export type BudgetDecision =
  | { allowed: true; tier: 'normal' | 'constrained' }
  | { allowed: false; reason: string; retryAfterMs?: number }

// ---------------------------------------------------------------------------
// Job payload shapes (registered in lib/jobs/handlers.ts)
// ---------------------------------------------------------------------------

export interface AuthorityQueryExecutionPayload {
  /** Max queries to dispatch in this run. */
  limit?: number
  /** Restrict to a single market when set (targeted re-run). */
  marketId?: string
  /** Restrict to a single engine key when set. */
  engineKey?: string
}

export interface AuthorityResponseParsingPayload {
  /** Max unparsed responses to process. */
  limit?: number
  /** Re-parse responses already parsed with an older parser version. */
  reparse?: boolean
}

export interface AuthorityCompetitorMonitorPayload {
  windowDays?: number
  snapshotDate?: string
}

export interface AuthorityWebsiteCrawlPayload {
  siteOrigin?: string
  maxPages?: number
  rateLimitMs?: number
}

export interface AuthorityScoringPayload {
  windowDays?: number
  marketId?: string
}

export interface AuthorityRecommendationGenerationPayload {
  limit?: number
  marketId?: string
  /** Recompute scores before generating. */
  rescore?: boolean
}

export interface AuthorityExperimentEvaluationPayload {
  experimentId?: string
}

export interface AuthorityDataQualityPayload {
  /** Cap on rows examined per check. */
  limit?: number
}

export interface AuthorityIntegrationSyncPayload {
  /** ISO date (inclusive). Defaults to a trailing window. */
  startDate?: string
  endDate?: string
  days?: number
}