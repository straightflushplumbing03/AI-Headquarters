-- ============================================================================
-- Migration 021: AI Authority Engine
--
-- Adds the AI-search-visibility subsystem to Business Brain for
-- Straight Flush Plumbing & Leak Detection.
--
-- DESIGN CONSTRAINTS (see docs/ai-authority/AUDIT.md):
--   * REUSE ONLY. No new auth, job queue, approval machine, budget ledger, or
--     audit table. The engine writes into background_jobs, approval_requests,
--     autonomous_decisions/actions, budget_reservations, audit_logs, and
--     recommendations exactly as they already exist.
--   * NO DUPLICATION. The pre-existing `opportunities` table is defined twice
--     (03 and 05) with incompatible shapes and is therefore NOT touched.
--     Authority opportunities live in their own table with explicit,
--     explainable score components.
--   * ADDITIVE. Every new table is uniquely named (verified against all
--     existing migrations); every existing-table change is a nullable column
--     or a CHECK-constraint widening using the same drop/recreate pattern
--     already proven by migrations 011 and 016.
--   * ASCII + IDEMPOTENT. Safe to re-run.
--   * TENANCY. Every table carries organization_id and a single fail-closed
--     FOR ALL policy with both USING and WITH CHECK.
--   * HONEST METRICS. Internal scores are named and scored as Business Brain
--     internal metrics. No column pretends to be an external platform ranking.
--
-- Seed entry point: seed_ai_authority_engine(uuid)
--   -> 5 priority cities, 4 priority services, 20 markets, 5 engines,
--      and the initial query template set. Fabricates NO project/review data.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. Widen the existing CHECK constraints that the engine extends.
--    Pattern copied from 011 (approval_status) and 016 (background_jobs).
-- ============================================================================

-- 0a. background_jobs.job_type -- register the AI Authority job types.
ALTER TABLE background_jobs DROP CONSTRAINT IF EXISTS background_jobs_job_type_check;
ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_job_type_check
  CHECK (job_type IN (
    'approval_expiration_sweep',
    'embedding_backfill',
    'execute_autonomous_action',
    'budget_reconciliation_sweep',
    -- AI Authority Engine
    'authority_query_execution',
    'authority_response_parsing',
    'authority_competitor_monitor',
    'authority_website_crawl',
    'authority_search_console_sync',
    'authority_gbp_sync',
    'authority_scoring',
    'authority_recommendation_generation',
    'authority_experiment_evaluation',
    'authority_data_quality_sweep'
  ));

-- 0b. autonomous_actions.action_type -- register the authority action types.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'autonomous_actions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%action_type%'
  LOOP
    EXECUTE format('ALTER TABLE autonomous_actions DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE autonomous_actions ADD CONSTRAINT autonomous_actions_action_type_check
  CHECK (action_type IN (
    'generate_report', 'create_task', 'send_alert', 'update_priority', 'launch_campaign',
    'adjust_budget', 'create_content', 'schedule_execution', 'modify_workflow', 'custom',
    'authority_content_brief',
    'authority_page_update',
    'authority_internal_link_plan',
    'authority_citation_opportunity',
    'authority_evidence_publish'
  ));

-- 0c. autonomous_decisions.decision_type -- register the authority decision type.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'autonomous_decisions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%decision_type%'
  LOOP
    EXECUTE format('ALTER TABLE autonomous_decisions DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE autonomous_decisions ADD CONSTRAINT autonomous_decisions_decision_type_check
  CHECK (decision_type IN (
    'revenue_opportunity', 'lead_quality', 'conversion_improvement', 'churn_prevention',
    'marketing_strategy', 'seo_action', 'competitive_response', 'service_demand',
    'cost_reduction', 'operational_improvement', 'customer_retention', 'custom',
    'authority_improvement'
  ));

-- 0d. website_pages -- crawl-graph enrichment (all nullable, additive).
--     Phase 4's WebsiteIntelligence keeps working unchanged.
ALTER TABLE website_pages ADD COLUMN IF NOT EXISTS status_code INTEGER;
ALTER TABLE website_pages ADD COLUMN IF NOT EXISTS canonical_url TEXT;
ALTER TABLE website_pages ADD COLUMN IF NOT EXISTS h1 TEXT;
ALTER TABLE website_pages ADD COLUMN IF NOT EXISTS headings JSONB;
ALTER TABLE website_pages ADD COLUMN IF NOT EXISTS schema_types TEXT[];
ALTER TABLE website_pages ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE website_pages ADD COLUMN IF NOT EXISTS outgoing_internal_urls TEXT[];
ALTER TABLE website_pages ADD COLUMN IF NOT EXISTS orphaned BOOLEAN;
ALTER TABLE website_pages ADD COLUMN IF NOT EXISTS last_crawled_at TIMESTAMP WITH TIME ZONE;

-- 0e. seo_experiments -- AI visibility metrics alongside search metrics.
ALTER TABLE seo_experiments ADD COLUMN IF NOT EXISTS visibility_baseline JSONB;
ALTER TABLE seo_experiments ADD COLUMN IF NOT EXISTS visibility_result JSONB;
ALTER TABLE seo_experiments ADD COLUMN IF NOT EXISTS authority_market_id uuid;

COMMIT;

BEGIN;

-- ============================================================================
-- 1. AUTHORITY_LOCATIONS -- cities / areas the business is measured in.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  state TEXT,
  county TEXT,

  -- Rollout control: 'priority' cities are monitored first; 'expansion' cities
  -- are supported by the schema but intentionally not yet resourced.
  tier TEXT NOT NULL DEFAULT 'expansion'
    CHECK (tier IN ('priority', 'expansion', 'archived')),

  -- Distinguishes the company's home market from surrounding service areas.
  is_home_market BOOLEAN NOT NULL DEFAULT false,
  nearby_location_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],

  latitude NUMERIC(10, 6),
  longitude NUMERIC(10, 6),

  -- Free-form local context (neighborhoods, landmarks, terminology).
  local_context JSONB NOT NULL DEFAULT '{}'::jsonb,

  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_locations_org_slug_unique UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_authority_locations_org_tier
  ON authority_locations (organization_id, tier);

ALTER TABLE authority_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_locations_org_isolation ON authority_locations;
CREATE POLICY authority_locations_org_isolation ON authority_locations
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 2. AUTHORITY_SERVICES -- service lines the business claims authority in.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  slug TEXT NOT NULL,

  -- 'priority' services are the initial authority focus; 'supporting' services
  -- exist in the taxonomy but are not separately scored in the first rollout.
  tier TEXT NOT NULL DEFAULT 'supporting'
    CHECK (tier IN ('priority', 'supporting', 'archived')),

  -- Estimated business value per qualified lead, used by the opportunity model.
  -- Nullable: unknown is a valid, honest state.
  customer_value_estimate NUMERIC(12, 2),
  customer_value_basis TEXT,

  -- Terminology customers actually use, fed to the query generator.
  customer_phrases TEXT[] NOT NULL DEFAULT '{}',
  problem_phrases TEXT[] NOT NULL DEFAULT '{}',

  related_service_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  active BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_services_org_slug_unique UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_authority_services_org_tier
  ON authority_services (organization_id, tier);

ALTER TABLE authority_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_services_org_isolation ON authority_services;
CREATE POLICY authority_services_org_isolation ON authority_services
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 3. AUTHORITY_MARKETS -- the city x service matrix.
--    One row per (organization, location, service). Every measurable metric
--    hangs off a market, which is what makes the matrix scorable and
--    explainable.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES authority_locations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES authority_services(id) ON DELETE CASCADE,

  active BOOLEAN NOT NULL DEFAULT true,

  -- Denormalized labels keep dashboards and exports simple and stable even if
  -- a location or service is later renamed.
  location_name TEXT NOT NULL,
  service_name TEXT NOT NULL,

  -- Optional linkage into the existing website graph.
  primary_page_id uuid REFERENCES website_pages(id) ON DELETE SET NULL,

  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_markets_unique UNIQUE (organization_id, location_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_authority_markets_org_active
  ON authority_markets (organization_id, active);
CREATE INDEX IF NOT EXISTS idx_authority_markets_location
  ON authority_markets (location_id);
CREATE INDEX IF NOT EXISTS idx_authority_markets_service
  ON authority_markets (service_id);

ALTER TABLE authority_markets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_markets_org_isolation ON authority_markets;
CREATE POLICY authority_markets_org_isolation ON authority_markets
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 4. AUTHORITY_ENGINES -- monitored AI/search surfaces.
--
--    `capability` records, truthfully, whether a surface can actually be
--    monitored today. Engines that cannot be monitored are still registered so
--    the UI can show an honest "not measurable" state instead of a fake zero.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_engines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  key TEXT NOT NULL,          -- 'chatgpt' | 'gemini' | 'perplexity' | 'grok' | 'google_ai'
  display_name TEXT NOT NULL,
  vendor TEXT,

  capability TEXT NOT NULL DEFAULT 'unsupported'
    CHECK (capability IN ('supported', 'requires_credential', 'unsupported')),

  credential_env_var TEXT,
  default_model TEXT,
  adapter_version TEXT NOT NULL DEFAULT 'v1',

  enabled BOOLEAN NOT NULL DEFAULT true,

  -- Per-engine cost control (see authority_budgets for org-wide ceilings).
  daily_query_limit INTEGER,
  monthly_query_limit INTEGER,

  last_query_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_engines_org_key_unique UNIQUE (organization_id, key)
);

ALTER TABLE authority_engines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_engines_org_isolation ON authority_engines;
CREATE POLICY authority_engines_org_isolation ON authority_engines
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 5. AUTHORITY_QUERY_TEMPLATES -- the query generator's source of truth.
--    Templates are compositional: they carry an intent dimension and a pattern
--    with {city}/{service}/{problem} slots rather than a fixed keyword list.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_query_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  pattern TEXT NOT NULL,
  intent TEXT NOT NULL
    CHECK (intent IN (
      'geographic', 'service', 'buyer', 'problem', 'comparison', 'emergency', 'cost'
    )),
  buyer_stage TEXT
    CHECK (buyer_stage IS NULL OR buyer_stage IN ('awareness', 'consideration', 'decision', 'retention')),

  -- Importance weight 1-10, used to size monitoring effort per query.
  base_importance INTEGER NOT NULL DEFAULT 5 CHECK (base_importance BETWEEN 1 AND 10),

  season_months INTEGER[],
  source TEXT NOT NULL DEFAULT 'seed'
    CHECK (source IN ('seed', 'search_console', 'website_search', 'customer_question',
                      'observed_ai', 'competitor_language', 'manual')),

  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_query_templates_unique UNIQUE (organization_id, pattern, intent)
);

CREATE INDEX IF NOT EXISTS idx_authority_query_templates_org_active
  ON authority_query_templates (organization_id, active);

ALTER TABLE authority_query_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_query_templates_org_isolation ON authority_query_templates;
CREATE POLICY authority_query_templates_org_isolation ON authority_query_templates
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 6. AUTHORITY_QUERIES -- concrete, de-duplicated query instances.
--
--    raw_text preserves what a human would actually type. normalized_text is
--    the intent-collapsed form used for metric aggregation, so that
--    "best leak detection company in San Clemente" and "who should I call for
--    leak detection in San Clemente" do not inflate counts as two intents.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  raw_text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,

  market_id uuid REFERENCES authority_markets(id) ON DELETE SET NULL,
  location_id uuid REFERENCES authority_locations(id) ON DELETE SET NULL,
  service_id uuid REFERENCES authority_services(id) ON DELETE SET NULL,

  intent TEXT NOT NULL DEFAULT 'service'
    CHECK (intent IN (
      'geographic', 'service', 'buyer', 'problem', 'comparison', 'emergency', 'cost'
    )),
  buyer_stage TEXT
    CHECK (buyer_stage IS NULL OR buyer_stage IN ('awareness', 'consideration', 'decision', 'retention')),

  template_id uuid REFERENCES authority_query_templates(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'generated'
    CHECK (source IN ('generated', 'manual', 'search_console', 'observed_ai', 'customer')),

  importance INTEGER NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  active BOOLEAN NOT NULL DEFAULT true,

  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_run_at TIMESTAMP WITH TIME ZONE,
  run_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_queries_org_normalized_unique
    UNIQUE (organization_id, normalized_text, intent)
);

CREATE INDEX IF NOT EXISTS idx_authority_queries_org_active
  ON authority_queries (organization_id, active);
CREATE INDEX IF NOT EXISTS idx_authority_queries_market
  ON authority_queries (market_id);
CREATE INDEX IF NOT EXISTS idx_authority_queries_org_importance
  ON authority_queries (organization_id, importance DESC);

ALTER TABLE authority_queries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_queries_org_isolation ON authority_queries;
CREATE POLICY authority_queries_org_isolation ON authority_queries
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 7. AUTHORITY_QUERY_RUNS -- one monitored execution of a query on an engine.
--    Idempotent per (organization, query, engine, run_key).
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_query_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  query_id uuid NOT NULL REFERENCES authority_queries(id) ON DELETE CASCADE,
  engine_id uuid NOT NULL REFERENCES authority_engines(id) ON DELETE CASCADE,
  market_id uuid REFERENCES authority_markets(id) ON DELETE SET NULL,

  run_key TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),

  skip_reason TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,

  model TEXT,
  latency_ms INTEGER,

  -- Cost control: reuses the org budget ledger; the run records what the
  -- engine reported so the ledger can be reconciled.
  estimated_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  actual_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
  budget_reservation_id uuid REFERENCES budget_reservations(id) ON DELETE SET NULL,
  tokens_input INTEGER,
  tokens_output INTEGER,

  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_query_runs_unique
    UNIQUE (organization_id, query_id, engine_id, run_key)
);

CREATE INDEX IF NOT EXISTS idx_authority_query_runs_org_created
  ON authority_query_runs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authority_query_runs_engine_created
  ON authority_query_runs (engine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authority_query_runs_status
  ON authority_query_runs (organization_id, status);

ALTER TABLE authority_query_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_query_runs_org_isolation ON authority_query_runs;
CREATE POLICY authority_query_runs_org_isolation ON authority_query_runs
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 8. AUTHORITY_RESPONSES -- the raw answer plus its parsed structure.
--    raw_response_text is retained verbatim for transparency (the Response
--    Explorer shows it). Parsed columns are derived, versioned, and
--    re-derivable: parser_version lets us re-parse history after improvements.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  run_id uuid NOT NULL REFERENCES authority_query_runs(id) ON DELETE CASCADE,
  query_id uuid NOT NULL REFERENCES authority_queries(id) ON DELETE CASCADE,
  engine_id uuid NOT NULL REFERENCES authority_engines(id) ON DELETE CASCADE,
  market_id uuid REFERENCES authority_markets(id) ON DELETE SET NULL,

  engine_key TEXT NOT NULL,
  model TEXT,
  captured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  raw_response_text TEXT NOT NULL,

  -- Parsed dimensions
  location_context TEXT,
  service_context TEXT,

  business_count INTEGER NOT NULL DEFAULT 0,
  straight_flush_mentioned BOOLEAN NOT NULL DEFAULT false,
  straight_flush_position INTEGER,
  straight_flush_cited BOOLEAN NOT NULL DEFAULT false,
  recommendation_language TEXT[] NOT NULL DEFAULT '{}',
  factual_claims JSONB NOT NULL DEFAULT '[]'::jsonb,

  parser_version TEXT NOT NULL DEFAULT 'v1',
  parse_confidence NUMERIC(5, 2) CHECK (parse_confidence IS NULL OR (parse_confidence >= 0 AND parse_confidence <= 100)),
  parse_notes TEXT,

  -- Internal metric: did the answer recommend Straight Flush at all? Named
  -- "internal" everywhere so it is never mistaken for a platform ranking.
  internal_recommended BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_responses_run_unique UNIQUE (run_id)
);

CREATE INDEX IF NOT EXISTS idx_authority_responses_org_captured
  ON authority_responses (organization_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_authority_responses_query
  ON authority_responses (query_id);
CREATE INDEX IF NOT EXISTS idx_authority_responses_market
  ON authority_responses (market_id);
CREATE INDEX IF NOT EXISTS idx_authority_responses_sf_mentioned
  ON authority_responses (organization_id, straight_flush_mentioned);

ALTER TABLE authority_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_responses_org_isolation ON authority_responses;
CREATE POLICY authority_responses_org_isolation ON authority_responses
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 9. AUTHORITY_MENTIONS -- every business named in a response, in order.
--    Straight Flush is recorded here too (is_subject = true) so that mention
--    frequency and first-position frequency are computed from one table.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  response_id uuid NOT NULL REFERENCES authority_responses(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES authority_query_runs(id) ON DELETE CASCADE,
  engine_id uuid NOT NULL REFERENCES authority_engines(id) ON DELETE CASCADE,
  market_id uuid REFERENCES authority_markets(id) ON DELETE SET NULL,

  -- Order of appearance in the answer (1-based).
  position INTEGER NOT NULL,
  business_name TEXT NOT NULL,
  normalized_business_name TEXT NOT NULL,

  is_subject BOOLEAN NOT NULL DEFAULT false,
  competitor_id uuid,

  website TEXT,
  services_associated TEXT[] NOT NULL DEFAULT '{}',
  locations_associated TEXT[] NOT NULL DEFAULT '{}',
  is_recommended BOOLEAN NOT NULL DEFAULT false,
  recommendation_context TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_authority_mentions_org_created
  ON authority_mentions (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authority_mentions_response
  ON authority_mentions (response_id);
CREATE INDEX IF NOT EXISTS idx_authority_mentions_business
  ON authority_mentions (organization_id, normalized_business_name);
CREATE INDEX IF NOT EXISTS idx_authority_mentions_subject
  ON authority_mentions (organization_id, is_subject, position);

ALTER TABLE authority_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_mentions_org_isolation ON authority_mentions;
CREATE POLICY authority_mentions_org_isolation ON authority_mentions
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 10. AUTHORITY_SOURCES -- canonical source domains observed in AI answers.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  domain TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'other'
    CHECK (source_type IN (
      'company_website', 'google_business_profile', 'review_platform', 'directory',
      'local_publication', 'news', 'trade_organization', 'government', 'social',
      'youtube', 'business_association', 'community_site', 'competitor_website', 'other'
    )),

  is_first_party BOOLEAN NOT NULL DEFAULT false,

  -- Internal quality indicators. These are Business Brain metrics, NOT a
  -- reproduction of any external platform's authority metric.
  internal_relevance NUMERIC(5, 2) CHECK (internal_relevance IS NULL OR (internal_relevance >= 0 AND internal_relevance <= 100)),
  internal_freshness NUMERIC(5, 2) CHECK (internal_freshness IS NULL OR (internal_freshness >= 0 AND internal_freshness <= 100)),
  internal_credibility NUMERIC(5, 2) CHECK (internal_credibility IS NULL OR (internal_credibility >= 0 AND internal_credibility <= 100)),

  classification_notes TEXT,
  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_sources_org_domain_unique UNIQUE (organization_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_authority_sources_org_type
  ON authority_sources (organization_id, source_type);

ALTER TABLE authority_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_sources_org_isolation ON authority_sources;
CREATE POLICY authority_sources_org_isolation ON authority_sources
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 11. AUTHORITY_CITATIONS -- one cited URL per response, deduped per response.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  response_id uuid NOT NULL REFERENCES authority_responses(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES authority_query_runs(id) ON DELETE CASCADE,
  engine_id uuid NOT NULL REFERENCES authority_engines(id) ON DELETE CASCADE,
  market_id uuid REFERENCES authority_markets(id) ON DELETE SET NULL,
  source_id uuid REFERENCES authority_sources(id) ON DELETE SET NULL,

  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'other',

  cited_business_name TEXT,
  is_first_party BOOLEAN NOT NULL DEFAULT false,
  citation_position INTEGER,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_citations_response_url_unique UNIQUE (response_id, url)
);

CREATE INDEX IF NOT EXISTS idx_authority_citations_org_created
  ON authority_citations (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authority_citations_domain
  ON authority_citations (organization_id, domain);
CREATE INDEX IF NOT EXISTS idx_authority_citations_market
  ON authority_citations (market_id);

ALTER TABLE authority_citations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_citations_org_isolation ON authority_citations;
CREATE POLICY authority_citations_org_isolation ON authority_citations
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 12. AUTHORITY_COMPETITORS -- discovered from AI answers and public sources.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  website TEXT,
  phone TEXT,

  discovery_source TEXT NOT NULL DEFAULT 'ai_answer'
    CHECK (discovery_source IN ('ai_answer', 'search_result', 'citation', 'manual', 'industry_source')),

  locations TEXT[] NOT NULL DEFAULT '{}',
  services TEXT[] NOT NULL DEFAULT '{}',

  is_primary BOOLEAN NOT NULL DEFAULT false,
  watch_enabled BOOLEAN NOT NULL DEFAULT true,

  first_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_competitors_org_name_unique UNIQUE (organization_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_authority_competitors_org_watch
  ON authority_competitors (organization_id, watch_enabled);

ALTER TABLE authority_competitors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_competitors_org_isolation ON authority_competitors;
CREATE POLICY authority_competitors_org_isolation ON authority_competitors
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 13. AUTHORITY_COMPETITOR_SNAPSHOTS -- periodic measured state.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_competitor_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_id uuid NOT NULL REFERENCES authority_competitors(id) ON DELETE CASCADE,

  snapshot_date DATE NOT NULL,
  window_days INTEGER NOT NULL DEFAULT 30,

  ai_mention_count INTEGER NOT NULL DEFAULT 0,
  ai_first_position_count INTEGER NOT NULL DEFAULT 0,
  ai_citation_count INTEGER NOT NULL DEFAULT 0,
  ai_response_count INTEGER NOT NULL DEFAULT 0,
  distinct_source_domains INTEGER NOT NULL DEFAULT 0,

  locations_seen TEXT[] NOT NULL DEFAULT '{}',
  services_seen TEXT[] NOT NULL DEFAULT '{}',
  engines_seen TEXT[] NOT NULL DEFAULT '{}',
  top_source_domains JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Internal derived share of voice for the window, 0-100.
  internal_share_of_voice NUMERIC(5, 2)
    CHECK (internal_share_of_voice IS NULL OR (internal_share_of_voice >= 0 AND internal_share_of_voice <= 100)),

  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_competitor_snapshots_unique
    UNIQUE (organization_id, competitor_id, snapshot_date, window_days)
);

CREATE INDEX IF NOT EXISTS idx_authority_competitor_snapshots_org_date
  ON authority_competitor_snapshots (organization_id, snapshot_date DESC);

ALTER TABLE authority_competitor_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_competitor_snapshots_org_isolation ON authority_competitor_snapshots;
CREATE POLICY authority_competitor_snapshots_org_isolation ON authority_competitor_snapshots
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 14. AUTHORITY_COMPETITOR_CHANGES -- detected deltas worth alerting on.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_competitor_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_id uuid NOT NULL REFERENCES authority_competitors(id) ON DELETE CASCADE,
  market_id uuid REFERENCES authority_markets(id) ON DELETE SET NULL,

  change_type TEXT NOT NULL
    CHECK (change_type IN (
      'new_page', 'changed_page', 'new_service_page', 'new_city_page', 'new_review',
      'new_media', 'new_citation', 'new_mention', 'ai_visibility_increase',
      'ai_visibility_decrease', 'search_visibility_change', 'new_competitor'
    )),

  significance TEXT NOT NULL DEFAULT 'low'
    CHECK (significance IN ('low', 'medium', 'high', 'critical')),

  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Material change that warrants a Business Brain alert / action assessment.
  warrants_action BOOLEAN NOT NULL DEFAULT false,
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'reviewed', 'acted_on', 'dismissed')),

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_competitor_changes_unique
    UNIQUE (organization_id, competitor_id, change_type, summary)
);

CREATE INDEX IF NOT EXISTS idx_authority_competitor_changes_org_detected
  ON authority_competitor_changes (organization_id, detected_at DESC);

ALTER TABLE authority_competitor_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_competitor_changes_org_isolation ON authority_competitor_changes;
CREATE POLICY authority_competitor_changes_org_isolation ON authority_competitor_changes
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 15. AUTHORITY_EVIDENCE -- first-party evidence ledger.
--
--    This table holds NO fabricated data. Every row is either imported from a
--    real Business Brain record or entered by a human. Verification and publish
--    permission are explicit, and nothing is publishable until they are set.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  evidence_type TEXT NOT NULL
    CHECK (evidence_type IN (
      'completed_project', 'leak_detection', 'slab_leak', 'water_line_reroute',
      'repipe', 'plumbing_repair', 'before_after', 'customer_review', 'photo',
      'video', 'invoice', 'estimate', 'service_record'
    )),

  title TEXT NOT NULL,
  description TEXT,

  location_id uuid REFERENCES authority_locations(id) ON DELETE SET NULL,
  service_id uuid REFERENCES authority_services(id) ON DELETE SET NULL,
  market_id uuid REFERENCES authority_markets(id) ON DELETE SET NULL,
  page_id uuid REFERENCES website_pages(id) ON DELETE SET NULL,

  occurred_on DATE,
  city_text TEXT,
  neighborhood TEXT,
  material TEXT,
  problem TEXT,
  resolution TEXT,

  -- Provenance: where this evidence actually came from. Never invented.
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'business_brain_project', 'review_import', 'invoice_import', 'media_upload')),
  source_record_id TEXT,

  media_urls TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Explicit consent / verification gates. Default is the safe state.
  customer_permission_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (customer_permission_status IN ('unknown', 'granted', 'denied')),
  publish_permission BOOLEAN NOT NULL DEFAULT false,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'rejected')),

  verified_by uuid,
  verified_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_evidence_org_source_unique
    UNIQUE (organization_id, source, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_authority_evidence_org_market
  ON authority_evidence (organization_id, market_id);
CREATE INDEX IF NOT EXISTS idx_authority_evidence_org_service
  ON authority_evidence (organization_id, service_id);
CREATE INDEX IF NOT EXISTS idx_authority_evidence_publishable
  ON authority_evidence (organization_id, publish_permission, verification_status);

ALTER TABLE authority_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_evidence_org_isolation ON authority_evidence;
CREATE POLICY authority_evidence_org_isolation ON authority_evidence
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 16. AUTHORITY_EVIDENCE_LINKS -- the entity graph.
--    Connects evidence to the entity it supports: a market, a page, a review,
--    a project, a photo, a citation. This is what makes evidence gaps
--    computable ("San Clemente + water-line reroute has no linked evidence").
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES authority_evidence(id) ON DELETE CASCADE,

  entity_type TEXT NOT NULL
    CHECK (entity_type IN (
      'location', 'service', 'market', 'page', 'project', 'review', 'photo',
      'video', 'citation', 'source', 'competitor'
    )),
  entity_id uuid NOT NULL,
  relation TEXT NOT NULL DEFAULT 'supports'
    CHECK (relation IN ('supports', 'mentions', 'illustrates', 'documents', 'contradicts')),

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_evidence_links_unique
    UNIQUE (organization_id, evidence_id, entity_type, entity_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_authority_evidence_links_entity
  ON authority_evidence_links (organization_id, entity_type, entity_id);

ALTER TABLE authority_evidence_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_evidence_links_org_isolation ON authority_evidence_links;
CREATE POLICY authority_evidence_links_org_isolation ON authority_evidence_links
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 17. AUTHORITY_SCORES -- point-in-time internal metric snapshots per market.
--
--    Every column is a Business Brain internal measurement derived from stored
--    observations. `internal_` prefixes make that explicit in the schema so no
--    consumer can mistake these for an external platform's ranking.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  market_id uuid NOT NULL REFERENCES authority_markets(id) ON DELETE CASCADE,

  measured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  window_days INTEGER NOT NULL DEFAULT 30,

  response_count INTEGER NOT NULL DEFAULT 0,

  -- Visibility family
  internal_mention_rate NUMERIC(5, 2),
  internal_first_mention_rate NUMERIC(5, 2),
  internal_citation_rate NUMERIC(5, 2),
  internal_website_citation_rate NUMERIC(5, 2),
  internal_visibility_score NUMERIC(5, 2),

  -- Coverage family
  evidence_count INTEGER NOT NULL DEFAULT 0,
  published_evidence_count INTEGER NOT NULL DEFAULT 0,
  content_coverage NUMERIC(5, 2),
  citation_coverage NUMERIC(5, 2),
  review_coverage NUMERIC(5, 2),
  project_coverage NUMERIC(5, 2),
  internal_authority_score NUMERIC(5, 2),

  -- Pressure / opportunity
  competitor_pressure NUMERIC(5, 2),
  internal_opportunity_score NUMERIC(5, 2),

  components JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_scores_unique
    UNIQUE (organization_id, market_id, measured_at, window_days)
);

CREATE INDEX IF NOT EXISTS idx_authority_scores_org_measured
  ON authority_scores (organization_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_authority_scores_market
  ON authority_scores (market_id, measured_at DESC);

ALTER TABLE authority_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_scores_org_isolation ON authority_scores;
CREATE POLICY authority_scores_org_isolation ON authority_scores
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 18. AUTHORITY_CITATION_GAPS -- where competitors appear and we do not.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_citation_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  market_id uuid REFERENCES authority_markets(id) ON DELETE CASCADE,
  source_id uuid REFERENCES authority_sources(id) ON DELETE CASCADE,

  domain TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'other',

  competitor_citation_count INTEGER NOT NULL DEFAULT 0,
  subject_citation_count INTEGER NOT NULL DEFAULT 0,

  gap_severity TEXT NOT NULL DEFAULT 'low'
    CHECK (gap_severity IN ('low', 'medium', 'high', 'critical')),

  -- 'citation_diversification' when we lean on first-party sources only.
  gap_type TEXT NOT NULL DEFAULT 'missing_third_party'
    CHECK (gap_type IN ('missing_third_party', 'citation_diversification', 'lost_citation', 'weak_source')),

  assessment TEXT,
  -- Explicitly records that this is an *opportunity to evaluate*, not an
  -- instruction to buy links. No automated link acquisition exists.
  recommended_approach TEXT,

  window_days INTEGER NOT NULL DEFAULT 30,
  measured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_citation_gaps_unique
    UNIQUE (organization_id, market_id, source_id, gap_type, measured_at)
);

CREATE INDEX IF NOT EXISTS idx_authority_citation_gaps_org
  ON authority_citation_gaps (organization_id, gap_severity, gap_type);

ALTER TABLE authority_citation_gaps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_citation_gaps_org_isolation ON authority_citation_gaps;
CREATE POLICY authority_citation_gaps_org_isolation ON authority_citation_gaps
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 19. AUTHORITY_OPPORTUNITIES -- explainable, component-scored priorities.
--
--    Deliberately NOT the pre-existing `opportunities` table (see audit 4).
--    Every score component is stored so the UI can explain the number and any
--    component can be recalculated without losing the reasoning.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  market_id uuid REFERENCES authority_markets(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'authority_gap'
    CHECK (category IN (
      'authority_gap', 'content_gap', 'citation_gap', 'evidence_gap',
      'technical_seo', 'internal_linking', 'competitor_pressure', 'expansion'
    )),

  -- WHAT
  what TEXT NOT NULL,
  -- WHY
  why TEXT NOT NULL,
  -- EVIDENCE
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- IMPACT
  impact TEXT,
  -- ACTION
  action TEXT,
  -- RISK
  risk TEXT,
  -- MEASUREMENT
  measurement TEXT,

  -- Prioritization model (each stored separately so the product is auditable)
  visibility_gap NUMERIC(6, 2),
  customer_value NUMERIC(6, 2),
  competitive_opportunity NUMERIC(6, 2),
  evidence_availability NUMERIC(6, 2),
  probability_of_improvement NUMERIC(6, 2),
  opportunity_score NUMERIC(6, 2),

  score_explanation TEXT,
  score_version TEXT NOT NULL DEFAULT 'v1',

  -- Approval routing, aligned to the repo's existing levels.
  approval_class TEXT NOT NULL DEFAULT 'yellow'
    CHECK (approval_class IN ('green', 'yellow', 'red')),
  approval_required BOOLEAN NOT NULL DEFAULT true,

  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'prioritized', 'recommended', 'in_progress', 'completed', 'dismissed', 'expired')),
  priority_rank INTEGER,

  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_opportunities_unique
    UNIQUE (organization_id, market_id, category, title)
);

CREATE INDEX IF NOT EXISTS idx_authority_opportunities_org_status
  ON authority_opportunities (organization_id, status, opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_authority_opportunities_market
  ON authority_opportunities (market_id);

ALTER TABLE authority_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_opportunities_org_isolation ON authority_opportunities;
CREATE POLICY authority_opportunities_org_isolation ON authority_opportunities
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 20. AUTHORITY_RECOMMENDATION_ACTIONS -- ordered steps behind a
--     recommendation, each independently approvable.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_recommendation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  opportunity_id uuid REFERENCES authority_opportunities(id) ON DELETE CASCADE,
  market_id uuid REFERENCES authority_markets(id) ON DELETE SET NULL,

  -- Link into the EXISTING phase-5 recommendations table (reused, not replaced).
  recommendation_id uuid REFERENCES recommendations(id) ON DELETE SET NULL,

  step_order INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  description TEXT,

  action_type TEXT NOT NULL DEFAULT 'authority_content_brief',
  approval_class TEXT NOT NULL DEFAULT 'yellow'
    CHECK (approval_class IN ('green', 'yellow', 'red')),

  -- Set when the step was routed through the existing approval machine.
  decision_id uuid REFERENCES autonomous_decisions(id) ON DELETE SET NULL,
  action_id uuid REFERENCES autonomous_actions(id) ON DELETE SET NULL,
  approval_request_id uuid REFERENCES approval_requests(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'awaiting_approval', 'approved', 'rejected', 'executing', 'executed', 'failed', 'skipped')),

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_recommendation_actions_unique
    UNIQUE (organization_id, opportunity_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_authority_rec_actions_org_status
  ON authority_recommendation_actions (organization_id, status);

ALTER TABLE authority_recommendation_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_recommendation_actions_org_isolation ON authority_recommendation_actions;
CREATE POLICY authority_recommendation_actions_org_isolation ON authority_recommendation_actions
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 21. AUTHORITY_ACTION_RESULTS -- measured outcome of an executed step.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_action_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  recommendation_action_id uuid REFERENCES authority_recommendation_actions(id) ON DELETE CASCADE,
  action_id uuid REFERENCES autonomous_actions(id) ON DELETE SET NULL,
  market_id uuid REFERENCES authority_markets(id) ON DELETE SET NULL,

  executed_at TIMESTAMP WITH TIME ZONE,
  measurement_window_days INTEGER NOT NULL DEFAULT 30,

  metrics_before JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics_after JSONB NOT NULL DEFAULT '{}'::jsonb,
  delta JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Deliberately cautious wording: "after", not "caused by".
  outcome TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending', 'improved', 'declined', 'neutral', 'inconclusive')),
  confidence NUMERIC(5, 2)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  notes TEXT,

  measured_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_action_results_unique
    UNIQUE (organization_id, recommendation_action_id, measurement_window_days)
);

CREATE INDEX IF NOT EXISTS idx_authority_action_results_org
  ON authority_action_results (organization_id, outcome);

ALTER TABLE authority_action_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_action_results_org_isolation ON authority_action_results;
CREATE POLICY authority_action_results_org_isolation ON authority_action_results
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 22. AUTHORITY_EXPERIMENTS -- controlled before/after measurement.
--     Complements the existing seo_experiments table rather than replacing it;
--     seo_experiments gained visibility_baseline/result columns in section 0e.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  market_id uuid REFERENCES authority_markets(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES authority_opportunities(id) ON DELETE SET NULL,

  name TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  change_description TEXT NOT NULL,
  change_type TEXT NOT NULL DEFAULT 'page_improvement'
    CHECK (change_type IN (
      'page_improvement', 'content_addition', 'internal_linking', 'evidence_addition',
      'citation_opportunity', 'technical_fix', 'schema_addition'
    )),

  metric TEXT NOT NULL DEFAULT 'internal_visibility_score',

  baseline JSONB NOT NULL DEFAULT '{}'::jsonb,
  baseline_captured_at TIMESTAMP WITH TIME ZONE,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'running', 'completed', 'abandoned')),

  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  planned_duration_days INTEGER NOT NULL DEFAULT 30,

  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary TEXT,
  confidence NUMERIC(5, 2)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),

  created_by uuid,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_experiments_unique UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_authority_experiments_org_status
  ON authority_experiments (organization_id, status);

ALTER TABLE authority_experiments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_experiments_org_isolation ON authority_experiments;
CREATE POLICY authority_experiments_org_isolation ON authority_experiments
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 23. AUTHORITY_EXPERIMENT_RESULTS -- time-series measurements per experiment.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_experiment_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  experiment_id uuid NOT NULL REFERENCES authority_experiments(id) ON DELETE CASCADE,

  measured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  phase TEXT NOT NULL DEFAULT 'after' CHECK (phase IN ('before', 'during', 'after')),

  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_experiment_results_unique
    UNIQUE (organization_id, experiment_id, measured_at, phase)
);

CREATE INDEX IF NOT EXISTS idx_authority_experiment_results_exp
  ON authority_experiment_results (experiment_id, measured_at);

ALTER TABLE authority_experiment_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_experiment_results_org_isolation ON authority_experiment_results;
CREATE POLICY authority_experiment_results_org_isolation ON authority_experiment_results
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 24. AUTHORITY_CRAWL_RUNS -- respectful crawler bookkeeping.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_crawl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  site_origin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'aborted')),

  pages_discovered INTEGER NOT NULL DEFAULT 0,
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  pages_failed INTEGER NOT NULL DEFAULT 0,
  pages_skipped_robots INTEGER NOT NULL DEFAULT 0,

  robots_fetched BOOLEAN NOT NULL DEFAULT false,
  robots_disallowed_count INTEGER NOT NULL DEFAULT 0,
  sitemap_urls_found INTEGER NOT NULL DEFAULT 0,

  rate_limit_ms INTEGER NOT NULL DEFAULT 1500,
  user_agent TEXT NOT NULL DEFAULT 'BusinessBrainAI-AuthorityBot/1.0',
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,

  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_authority_crawl_runs_org_started
  ON authority_crawl_runs (organization_id, started_at DESC);

ALTER TABLE authority_crawl_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_crawl_runs_org_isolation ON authority_crawl_runs;
CREATE POLICY authority_crawl_runs_org_isolation ON authority_crawl_runs
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 25. AUTHORITY_PAGE_LINKS -- internal-link graph edges.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_page_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  from_page_id uuid REFERENCES website_pages(id) ON DELETE CASCADE,
  from_url TEXT NOT NULL,
  to_url TEXT NOT NULL,
  to_page_id uuid REFERENCES website_pages(id) ON DELETE SET NULL,
  anchor_text TEXT,

  is_internal BOOLEAN NOT NULL DEFAULT true,
  link_kind TEXT NOT NULL DEFAULT 'content'
    CHECK (link_kind IN ('content', 'nav', 'footer', 'breadcrumb', 'cta')),

  crawl_run_id uuid REFERENCES authority_crawl_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_page_links_unique
    UNIQUE (organization_id, from_url, to_url, anchor_text)
);

CREATE INDEX IF NOT EXISTS idx_authority_page_links_from
  ON authority_page_links (organization_id, from_url);
CREATE INDEX IF NOT EXISTS idx_authority_page_links_to
  ON authority_page_links (organization_id, to_url);

ALTER TABLE authority_page_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_page_links_org_isolation ON authority_page_links;
CREATE POLICY authority_page_links_org_isolation ON authority_page_links
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 26. AUTHORITY_TECHNICAL_ISSUES -- detected technical SEO problems.
--     Detection only; nothing here changes production.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_technical_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  page_id uuid REFERENCES website_pages(id) ON DELETE CASCADE,
  url TEXT NOT NULL,

  issue_type TEXT NOT NULL
    CHECK (issue_type IN (
      'broken_link', 'http_error', 'redirect_chain', 'canonical_mismatch',
      'duplicate_title', 'duplicate_meta_description', 'missing_title',
      'missing_h1', 'missing_schema', 'invalid_schema', 'orphan_page',
      'sitemap_problem', 'robots_issue', 'slow_page', 'mobile_issue',
      'thin_content', 'doorway_page_risk', 'duplicate_content'
    )),

  severity TEXT NOT NULL DEFAULT 'low'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),

  detail TEXT,
  recommendation TEXT,
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'wont_fix', 'stale')),
  resolved_at TIMESTAMP WITH TIME ZONE,

  crawl_run_id uuid REFERENCES authority_crawl_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_technical_issues_unique
    UNIQUE (organization_id, url, issue_type)
);

CREATE INDEX IF NOT EXISTS idx_authority_technical_issues_org_status
  ON authority_technical_issues (organization_id, status, severity);

ALTER TABLE authority_technical_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_technical_issues_org_isolation ON authority_technical_issues;
CREATE POLICY authority_technical_issues_org_isolation ON authority_technical_issues
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 27. AUTHORITY_BUDGETS -- per-org AI monitoring ceilings.
--     Complements ai_usage_limits (money) with monitoring VOLUME limits, which
--     is what actually runs away when query generation is unbounded.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_budgets (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

  daily_query_limit INTEGER NOT NULL DEFAULT 200 CHECK (daily_query_limit >= 0),
  monthly_query_limit INTEGER NOT NULL DEFAULT 4000 CHECK (monthly_query_limit >= 0),
  per_query_cost_ceiling NUMERIC(12, 6) NOT NULL DEFAULT 0.25 CHECK (per_query_cost_ceiling >= 0),
  monthly_cost_ceiling NUMERIC(12, 2) NOT NULL DEFAULT 50 CHECK (monthly_cost_ceiling >= 0),

  -- Lower-priority queries are dropped first when a ceiling is hit.
  min_importance_when_constrained INTEGER NOT NULL DEFAULT 7
    CHECK (min_importance_when_constrained BETWEEN 1 AND 10),

  paused BOOLEAN NOT NULL DEFAULT false,
  pause_reason TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE authority_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_budgets_org_isolation ON authority_budgets;
CREATE POLICY authority_budgets_org_isolation ON authority_budgets
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 28. AUTHORITY_INTEGRATIONS -- credential-gated external data sources.
--     Stores NO secrets: only which env var holds the credential and the
--     honest current status.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  provider TEXT NOT NULL
    CHECK (provider IN ('google_search_console', 'google_business_profile')),
  display_name TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'unconfigured'
    CHECK (status IN ('unconfigured', 'configured', 'connected', 'error', 'revoked')),

  credential_env_vars TEXT[] NOT NULL DEFAULT '{}',
  property_or_location TEXT,

  last_sync_at TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  sync_cursor JSONB NOT NULL DEFAULT '{}'::jsonb,

  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_integrations_unique UNIQUE (organization_id, provider)
);

ALTER TABLE authority_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_integrations_org_isolation ON authority_integrations;
CREATE POLICY authority_integrations_org_isolation ON authority_integrations
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 29. AUTHORITY_SEARCH_METRICS -- Search Console observations (when connected).
--     Additive to website_pages.search_impressions/clicks (page-level) because
--     this is query-level and time-series.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_search_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  provider TEXT NOT NULL DEFAULT 'google_search_console'
    CHECK (provider IN ('google_search_console')),

  metric_date DATE NOT NULL,
  query_text TEXT NOT NULL,
  page_url TEXT,
  country TEXT,
  device TEXT,

  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  ctr NUMERIC(6, 4),
  position NUMERIC(8, 2),

  market_id uuid REFERENCES authority_markets(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_search_metrics_unique
    UNIQUE (organization_id, provider, metric_date, query_text, page_url, country, device)
);

CREATE INDEX IF NOT EXISTS idx_authority_search_metrics_org_date
  ON authority_search_metrics (organization_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_authority_search_metrics_query
  ON authority_search_metrics (organization_id, query_text);

ALTER TABLE authority_search_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_search_metrics_org_isolation ON authority_search_metrics;
CREATE POLICY authority_search_metrics_org_isolation ON authority_search_metrics
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 30. AUTHORITY_GBP_METRICS -- Google Business Profile observations.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_gbp_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  metric_date DATE NOT NULL,
  location_ref TEXT,

  impressions_search INTEGER,
  impressions_maps INTEGER,
  website_clicks INTEGER,
  phone_calls INTEGER,
  direction_requests INTEGER,
  conversations INTEGER,
  bookings INTEGER,

  review_count INTEGER,
  average_rating NUMERIC(3, 2),
  new_reviews INTEGER,

  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_gbp_metrics_unique
    UNIQUE (organization_id, metric_date, location_ref)
);

CREATE INDEX IF NOT EXISTS idx_authority_gbp_metrics_org_date
  ON authority_gbp_metrics (organization_id, metric_date DESC);

ALTER TABLE authority_gbp_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_gbp_metrics_org_isolation ON authority_gbp_metrics;
CREATE POLICY authority_gbp_metrics_org_isolation ON authority_gbp_metrics
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 31. AUTHORITY_ALERTS -- prioritized, actionable notifications.
--     Business Brain alerts for the authority domain; the existing
--     competitor_alerts table remains for phase-4 competitor findings.
-- ============================================================================
CREATE TABLE IF NOT EXISTS authority_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  alert_type TEXT NOT NULL
    CHECK (alert_type IN (
      'visibility_drop', 'competitor_visibility_increase', 'new_competitor',
      'citation_loss', 'broken_important_page', 'indexing_problem',
      'search_console_decline', 'competitor_review_surge', 'new_competitor_service_page',
      'high_value_opportunity', 'evidence_gap', 'technical_seo_problem',
      'integration_error', 'data_quality_problem'
    )),

  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),

  title TEXT NOT NULL,
  detail TEXT,
  market_id uuid REFERENCES authority_markets(id) ON DELETE SET NULL,
  competitor_id uuid REFERENCES authority_competitors(id) ON DELETE SET NULL,

  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'acknowledged', 'actioned', 'dismissed', 'expired')),

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMP WITH TIME ZONE,

  CONSTRAINT authority_alerts_unique UNIQUE (organization_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_authority_alerts_org_status
  ON authority_alerts (organization_id, status, severity, created_at DESC);

ALTER TABLE authority_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_alerts_org_isolation ON authority_alerts;
CREATE POLICY authority_alerts_org_isolation ON authority_alerts
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

COMMIT;

-- ============================================================================
-- 32. SEED FUNCTION -- initial cities, services, markets, engines, templates.
--
--     Fabricates NO projects, reviews, photos, or AI results. It creates only
--     the taxonomy and the monitoring configuration, plus the honest
--     `unsupported` / `requires_credential` state for every engine.
--
--     Idempotent: safe to call repeatedly. Takes the organization id
--     explicitly so it can never seed the wrong tenant.
-- ============================================================================
CREATE OR REPLACE FUNCTION seed_ai_authority_engine(p_organization_id uuid)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_location RECORD;
  v_service RECORD;
  v_market_id uuid;
  v_market_count INTEGER := 0;
  v_template_count INTEGER := 0;
  v_tpl RECORD;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'seed_ai_authority_engine: organization id is required';
  END IF;

  -- --------------------------------------------------------------------------
  -- 32a. Five initial priority cities.
  -- --------------------------------------------------------------------------
  FOR v_location IN
    SELECT * FROM (VALUES
      ('Laguna Niguel',  'laguna-niguel',  1),
      ('Dana Point',     'dana-point',     2),
      ('San Clemente',   'san-clemente',   3),
      ('Ladera Ranch',   'ladera-ranch',   4),
      ('Laguna Hills',   'laguna-hills',   5)
    ) AS t(name, slug, sort_order)
  LOOP
    INSERT INTO authority_locations (
      organization_id, name, slug, state, county, tier, is_home_market, local_context
    )
    VALUES (
      p_organization_id, v_location.name, v_location.slug,
      'CA', 'Orange County', 'priority', false,
      jsonb_build_object(
        'region', 'South Orange County',
        'initial_priority', true,
        'sort_order', v_location.sort_order
      )
    )
    ON CONFLICT (organization_id, slug) DO NOTHING;
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 32b. Four initial priority services, with real customer phrasing used by
  --      the query generator. No performance claims are encoded here.
  -- --------------------------------------------------------------------------
  FOR v_service IN
    SELECT * FROM (VALUES
      ('Leak Detection', 'leak-detection', 1,
        ARRAY['leak detection', 'find a hidden water leak', 'water leak detection', 'electronic leak detection'],
        ARRAY['high water bill', 'wet floor', 'hidden leak', 'underground leak', 'loss of water pressure']),
      ('Slab Leak Detection', 'slab-leak-detection', 2,
        ARRAY['slab leak detection', 'slab leak repair', 'detect a slab leak', 'under slab leak'],
        ARRAY['suspected slab leak', 'hot water disappearing', 'warm spot on the floor', 'water damage']),
      ('Water-Line Leak Detection / Rerouting', 'water-line-leak-detection-rerouting', 3,
        ARRAY['water line leak detection', 'water line reroute', 'rerouting a leaking water line', 'main water line leak'],
        ARRAY['leaking copper line', 'old plumbing', 'water line break', 'repeated pipe leaks']),
      ('Whole-House Repiping', 'whole-house-repiping', 4,
        ARRAY['whole house repiping', 'PEX repiping', 'repipe', 'whole home repipe'],
        ARRAY['old plumbing', 'repeated leaks', 'galvanized pipes', 'low water pressure throughout house'])
    ) AS t(name, slug, sort_order, customer_phrases, problem_phrases)
  LOOP
    INSERT INTO authority_services (
      organization_id, name, slug, tier, customer_phrases, problem_phrases
    )
    VALUES (
      p_organization_id, v_service.name, v_service.slug, 'priority',
      v_service.customer_phrases, v_service.problem_phrases
    )
    ON CONFLICT (organization_id, slug) DO NOTHING;
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 32c. The city x service matrix (5 x 4 = 20 initial markets).
  -- --------------------------------------------------------------------------
  FOR v_location IN
    SELECT id, name FROM authority_locations
    WHERE organization_id = p_organization_id AND tier = 'priority'
  LOOP
    FOR v_service IN
      SELECT id, name FROM authority_services
      WHERE organization_id = p_organization_id AND tier = 'priority'
    LOOP
      INSERT INTO authority_markets (
        organization_id, location_id, service_id, location_name, service_name
      )
      VALUES (
        p_organization_id, v_location.id, v_service.id, v_location.name, v_service.name
      )
      ON CONFLICT (organization_id, location_id, service_id) DO NOTHING;

      v_market_count := v_market_count + 1;
    END LOOP;
  END LOOP;

  -- --------------------------------------------------------------------------
  -- 32d. Engines, registered with their HONEST monitoring capability.
  --      Nothing here claims a surface is monitorable when it is not.
  -- --------------------------------------------------------------------------
  INSERT INTO authority_engines (
    organization_id, key, display_name, vendor, capability,
    credential_env_var, default_model, enabled
  )
  VALUES
    (p_organization_id, 'chatgpt', 'ChatGPT',
      'OpenAI', 'requires_credential', 'OPENAI_API_KEY', 'gpt-4o', true),
    (p_organization_id, 'gemini', 'Gemini',
      'Google', 'requires_credential', 'GEMINI_API_KEY', 'gemini-1.5-pro', true),
    (p_organization_id, 'perplexity', 'Perplexity',
      'Perplexity AI', 'requires_credential', 'PERPLEXITY_API_KEY', 'sonar', true),
    (p_organization_id, 'grok', 'Grok',
      'xAI', 'requires_credential', 'XAI_API_KEY', 'grok-2', true),
    (p_organization_id, 'google_ai', 'Google AI / Search surfaces',
      'Google', 'unsupported', NULL, NULL, false)
  ON CONFLICT (organization_id, key) DO NOTHING;

  -- --------------------------------------------------------------------------
  -- 32e. Organization-level monitoring ceilings (conservative defaults).
  -- --------------------------------------------------------------------------
  INSERT INTO authority_budgets (organization_id)
  VALUES (p_organization_id)
  ON CONFLICT (organization_id) DO NOTHING;

  -- --------------------------------------------------------------------------
  -- 32f. Integrations, honestly marked unconfigured.
  -- --------------------------------------------------------------------------
  INSERT INTO authority_integrations (
    organization_id, provider, display_name, status, credential_env_vars, enabled
  )
  VALUES
    (p_organization_id, 'google_search_console', 'Google Search Console',
      'unconfigured',
      ARRAY['GOOGLE_SEARCH_CONSOLE_CLIENT_ID','GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET','GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN'],
      false),
    (p_organization_id, 'google_business_profile', 'Google Business Profile',
      'unconfigured',
      ARRAY['GOOGLE_BUSINESS_PROFILE_CLIENT_ID','GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET','GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN'],
      false)
  ON CONFLICT (organization_id, provider) DO NOTHING;

  -- --------------------------------------------------------------------------
  -- 32g. Query templates across every required intent dimension.
  --      {city} is replaced with the market's city, {service} with the
  --      service's primary phrase, {problem} with a problem phrase.
  -- --------------------------------------------------------------------------
  FOR v_tpl IN
    SELECT * FROM (VALUES
      -- Geographic intent
      ('Who is a good plumber in {city}?',                          'geographic',    'awareness',     6),
      ('Who are the best plumbing companies near {city}?',          'geographic',    'consideration', 7),
      ('Plumbing companies in {city} CA',                           'geographic',    'awareness',     5),
      ('Local plumber near {city}',                                 'geographic',    'awareness',     6),

      -- Service intent
      ('Who does {service} in {city}?',                             'service',       'consideration', 9),
      ('Which plumbing companies specialize in {service}?',         'service',       'consideration', 7),
      ('{service} companies in {city}',                             'service',       'consideration', 8),
      ('Who can help with {service} near {city}?',                  'service',       'consideration', 8),

      -- Buyer intent
      ('Who is the most reputable plumber for {service} in {city}?','buyer',         'decision',      8),
      ('Highly rated {service} in {city}',                          'buyer',         'decision',      8),
      ('Recommended {service} company in {city}',                   'buyer',         'decision',      9),
      ('Experienced {service} specialist in {city}',                'buyer',         'decision',      7),

      -- Problem intent
      ('Who should I call for {problem} in {city}?',                'problem',       'decision',      9),
      ('Plumber for {problem} in {city}',                           'problem',       'decision',      8),
      ('What causes {problem} and who fixes it in {city}?',         'problem',       'awareness',     6),

      -- Comparison intent
      ('Best leak detection companies in South Orange County',      'comparison',    'consideration', 6),
      ('Leak detection company vs general plumber in {city}',       'comparison',    'consideration', 5),
      ('Compare repipe companies in {city}',                        'comparison',    'consideration', 5),

      -- Emergency intent
      ('Emergency plumber in {city} for {problem}',                 'emergency',     'decision',      8),
      ('Same day {service} in {city}',                              'emergency',     'decision',      8),

      -- Cost intent
      ('How much does {service} cost in {city}?',                   'cost',          'consideration', 7),
      ('{service} cost in {city} CA',                               'cost',          'consideration', 6)
    ) AS t(pattern, intent, buyer_stage, base_importance)
  LOOP
    INSERT INTO authority_query_templates (
      organization_id, pattern, intent, buyer_stage, base_importance, source
    )
    VALUES (
      p_organization_id, v_tpl.pattern, v_tpl.intent, v_tpl.buyer_stage,
      v_tpl.base_importance, 'seed'
    )
    ON CONFLICT (organization_id, pattern, intent) DO NOTHING;

    v_template_count := v_template_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'seeded', true,
    'organization_id', p_organization_id,
    'cities', 5,
    'services', 4,
    'markets', v_market_count,
    'engines', 5,
    'templates', v_template_count,
    'note', 'Taxonomy and monitoring configuration only. No projects, reviews, or AI results were fabricated.'
  );
END $$;

COMMENT ON FUNCTION seed_ai_authority_engine(uuid) IS
  'Idempotently seeds the AI Authority Engine taxonomy for one organization: 5 priority cities, 4 priority services, the 20-market city x service matrix, 5 AI engine registrations with honest capability states, query templates, budget ceilings, and unconfigured integration records. Creates no fabricated business evidence.';