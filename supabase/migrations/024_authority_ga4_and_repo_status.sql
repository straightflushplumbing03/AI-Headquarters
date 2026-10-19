-- AI Authority Engine: Google Analytics 4 connection + repository status.
--
-- Adds GA4 and a read-only GitHub repository integration as first-class
-- providers, plus a metrics table for the daily property metrics pulled from
-- the GA4 Data API. Mirrors the Search Console integration (021) so the
-- honest-evidence rules are identical:
--   * credential-gated: absent credentials => `unconfigured`, nothing is faked
--   * read-only: this table is written only by the sync job, never by hand
--   * org-isolated: same RLS predicate as every other authority table
--
-- Additive and re-runnable. No existing rows are modified.

BEGIN;

-- 1. Widen the provider CHECK on authority_integrations.
--    The constraint name is the implicit one Postgres derives from the inline
--    CHECK in 021, so drop/recreate follows the 016/023 pattern.
ALTER TABLE authority_integrations DROP CONSTRAINT IF EXISTS authority_integrations_provider_check;
ALTER TABLE authority_integrations ADD CONSTRAINT authority_integrations_provider_check
  CHECK (provider IN (
    'google_search_console',
    'google_business_profile',
    'google_analytics_4',
    'github_repository'
  ));

-- 2. Daily GA4 property metrics.
CREATE TABLE IF NOT EXISTS authority_ga4_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  property_id TEXT NOT NULL,
  metric_date DATE NOT NULL,

  sessions INTEGER,
  total_users INTEGER,
  new_users INTEGER,
  engaged_sessions INTEGER,
  engagement_rate NUMERIC(6, 5),
  screen_page_views INTEGER,
  average_session_duration NUMERIC(10, 2),
  conversions INTEGER,
  -- A conversion is only meaningful when the property defines key events.
  -- NULL means "not reported by the API", never zero.
  conversions_available BOOLEAN NOT NULL DEFAULT false,

  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT authority_ga4_metrics_unique
    UNIQUE (organization_id, property_id, metric_date)
);

ALTER TABLE authority_ga4_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_ga4_metrics_org_isolation ON authority_ga4_metrics;
CREATE POLICY authority_ga4_metrics_org_isolation ON authority_ga4_metrics
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS authority_ga4_metrics_org_date_idx
  ON authority_ga4_metrics (organization_id, metric_date DESC);

-- 3. Register the GA4 sync job type alongside the other authority jobs.
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
    'authority_ga4_sync',
    'authority_scoring',
    'authority_recommendation_generation',
    'authority_experiment_evaluation',
    'authority_data_quality_sweep',
    -- Daily business summary (6:00 AM Pacific cadence)
    'authority_daily_briefing'
  ));

COMMIT;
