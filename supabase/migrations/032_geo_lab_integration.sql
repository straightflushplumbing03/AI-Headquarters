-- ============================================================================
-- Migration 032: GEO Lab integration
--
-- Stores research imported from the GEO Intelligence Lab
-- (straightflushplumbing03/-Up2datewebsiteseo, geo-lab/). The Lab runs on a
-- different stack (Next.js + SQLite) and is reached over its authenticated
-- /api/v1 API, so the two applications share no database.
--
-- DESIGN CONSTRAINTS
--   * ADDITIVE. New, uniquely-named tables only. No existing table is altered,
--     so the Authority Engine is untouched.
--   * IDEMPOTENT. Safe to re-run (IF NOT EXISTS throughout).
--   * TENANCY. Every table carries organization_id and the same fail-closed
--     FOR ALL policy used by the Authority Engine (migration 021), with both
--     USING and WITH CHECK.
--   * DEDUPE BY SOURCE KEY. Each imported row carries the Lab's own row id
--     plus a natural key, with a UNIQUE constraint so a re-sync cannot create
--     duplicates. This is what makes re-running a sync safe.
--   * HONEST METRICS. Rates are stored as the Lab measured them, alongside the
--     definition of the rate, so a display can never present a derived number
--     as a platform-reported figure.
--   * NO FABRICATED DATA. Nothing is seeded here. Every row arrives from a
--     real API response; an unconfigured integration stores nothing.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. GEO_LAB_SYNC_RUNS -- one row per synchronization attempt.
--    This is the audit trail behind the connection-status screen: how many
--    records came in, what failed, and when the last success was.
-- ============================================================================
CREATE TABLE IF NOT EXISTS geo_lab_sync_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  status            TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),

  -- Per-resource counts so a partial sync is explainable rather than opaque.
  records_fetched   integer NOT NULL DEFAULT 0,
  records_imported  integer NOT NULL DEFAULT 0,
  records_skipped   integer NOT NULL DEFAULT 0,

  lab_version       TEXT,
  lab_generated_at  timestamptz,
  duration_ms       integer,
  error_reason      TEXT,
  error_message     TEXT,

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geo_lab_sync_runs_org_started_idx
  ON geo_lab_sync_runs (organization_id, started_at DESC);

ALTER TABLE geo_lab_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geo_lab_sync_runs_org_isolation ON geo_lab_sync_runs;
CREATE POLICY geo_lab_sync_runs_org_isolation ON geo_lab_sync_runs
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 2. GEO_LAB_VISIBILITY -- AI visibility observations imported from the Lab.
--    One row per (query, platform) observation. `source_row_id` is the Lab's
--    own id, so re-importing the same observation updates rather than
--    duplicates it.
-- ============================================================================
CREATE TABLE IF NOT EXISTS geo_lab_visibility (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sync_run_id       uuid REFERENCES geo_lab_sync_runs(id) ON DELETE SET NULL,

  source_row_id     bigint NOT NULL,
  source_run_id     bigint,
  observed_at       timestamptz NOT NULL,

  query             TEXT NOT NULL,
  platform          TEXT NOT NULL,
  test_type         TEXT,
  status            TEXT,

  -- Kept separate on purpose. A mention, a recommendation and a citation are
  -- three different findings and are never summed into one score.
  mentioned         boolean NOT NULL DEFAULT false,
  recommended       boolean NOT NULL DEFAULT false,
  cited_urls        jsonb NOT NULL DEFAULT '[]'::jsonb,
  competitors       jsonb NOT NULL DEFAULT '[]'::jsonb,

  rank              integer,
  city              TEXT,
  service           TEXT,
  confidence        TEXT,

  imported_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT geo_lab_visibility_source_unique UNIQUE (organization_id, source_row_id)
);

CREATE INDEX IF NOT EXISTS geo_lab_visibility_org_observed_idx
  ON geo_lab_visibility (organization_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS geo_lab_visibility_org_city_idx
  ON geo_lab_visibility (organization_id, city);
CREATE INDEX IF NOT EXISTS geo_lab_visibility_org_platform_idx
  ON geo_lab_visibility (organization_id, platform);

ALTER TABLE geo_lab_visibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geo_lab_visibility_org_isolation ON geo_lab_visibility;
CREATE POLICY geo_lab_visibility_org_isolation ON geo_lab_visibility
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 3. GEO_LAB_VISIBILITY_HISTORY -- the aggregated daily series, preserved.
--    The Lab computes the rates; we store them together with the definition
--    of the rate so a display cannot misrepresent them.
-- ============================================================================
CREATE TABLE IF NOT EXISTS geo_lab_visibility_history (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  day               date NOT NULL,
  observations      integer NOT NULL DEFAULT 0,
  mentions          integer NOT NULL DEFAULT 0,
  recommendations   integer NOT NULL DEFAULT 0,
  citations         integer NOT NULL DEFAULT 0,

  mention_rate        numeric(5,2),
  recommendation_rate numeric(5,2),
  citation_rate       numeric(5,2),
  avg_rank            numeric(6,2),
  rate_definition     TEXT,

  imported_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT geo_lab_visibility_history_unique UNIQUE (organization_id, day)
);

CREATE INDEX IF NOT EXISTS geo_lab_visibility_history_org_day_idx
  ON geo_lab_visibility_history (organization_id, day DESC);

ALTER TABLE geo_lab_visibility_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geo_lab_visibility_history_org_isolation ON geo_lab_visibility_history;
CREATE POLICY geo_lab_visibility_history_org_isolation ON geo_lab_visibility_history
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 4. GEO_LAB_COMPETITORS -- competitor observations with share of voice.
-- ============================================================================
CREATE TABLE IF NOT EXISTS geo_lab_competitors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sync_run_id       uuid REFERENCES geo_lab_sync_runs(id) ON DELETE SET NULL,

  source_row_id     bigint NOT NULL,
  domain            TEXT NOT NULL,
  name              TEXT,
  tier              TEXT,
  home_city         TEXT,

  appearances       integer NOT NULL DEFAULT 0,
  observations      integer NOT NULL DEFAULT 0,
  share_of_voice    numeric(5,2),
  last_platform     TEXT,
  last_seen_at      timestamptz,

  imported_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT geo_lab_competitors_source_unique UNIQUE (organization_id, source_row_id)
);

CREATE INDEX IF NOT EXISTS geo_lab_competitors_org_sov_idx
  ON geo_lab_competitors (organization_id, share_of_voice DESC NULLS LAST);

ALTER TABLE geo_lab_competitors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geo_lab_competitors_org_isolation ON geo_lab_competitors;
CREATE POLICY geo_lab_competitors_org_isolation ON geo_lab_competitors
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 5. GEO_LAB_CITATIONS -- citation sources, with whether the domain is ours.
-- ============================================================================
CREATE TABLE IF NOT EXISTS geo_lab_citations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sync_run_id       uuid REFERENCES geo_lab_sync_runs(id) ON DELETE SET NULL,

  domain            TEXT NOT NULL,
  citations         integer NOT NULL DEFAULT 0,
  owned_citations   integer NOT NULL DEFAULT 0,
  first_seen_at     timestamptz,
  last_seen_at      timestamptz,

  imported_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT geo_lab_citations_unique UNIQUE (organization_id, domain)
);

CREATE INDEX IF NOT EXISTS geo_lab_citations_org_citations_idx
  ON geo_lab_citations (organization_id, citations DESC);

ALTER TABLE geo_lab_citations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geo_lab_citations_org_isolation ON geo_lab_citations;
CREATE POLICY geo_lab_citations_org_isolation ON geo_lab_citations
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 6. GEO_LAB_GEO -- geographic visibility, one row per city.
--    Laguna Niguel is the initial priority market; `priority` records that so
--    the dashboard can lead with it without hardcoding the city name.
-- ============================================================================
CREATE TABLE IF NOT EXISTS geo_lab_geo (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sync_run_id         uuid REFERENCES geo_lab_sync_runs(id) ON DELETE SET NULL,

  city                TEXT NOT NULL,
  priority            boolean NOT NULL DEFAULT false,
  observations        integer NOT NULL DEFAULT 0,
  mentions            integer NOT NULL DEFAULT 0,
  recommendations     integer NOT NULL DEFAULT 0,
  mention_rate        numeric(5,2),
  recommendation_rate numeric(5,2),
  avg_rank            numeric(6,2),
  platforms           integer NOT NULL DEFAULT 0,
  last_observed_at    timestamptz,

  imported_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT geo_lab_geo_unique UNIQUE (organization_id, city)
);

CREATE INDEX IF NOT EXISTS geo_lab_geo_org_priority_idx
  ON geo_lab_geo (organization_id, priority DESC, observations DESC);

ALTER TABLE geo_lab_geo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geo_lab_geo_org_isolation ON geo_lab_geo;
CREATE POLICY geo_lab_geo_org_isolation ON geo_lab_geo
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 7. GEO_LAB_OPPORTUNITIES -- recommended improvements from the Lab.
-- ============================================================================
CREATE TABLE IF NOT EXISTS geo_lab_opportunities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sync_run_id       uuid REFERENCES geo_lab_sync_runs(id) ON DELETE SET NULL,

  source_row_id     bigint NOT NULL,
  identified_at     timestamptz,
  title             TEXT,
  problem           TEXT,
  evidence          TEXT,
  url               TEXT,
  section           TEXT,
  geo_layer         TEXT,
  expected_benefit  TEXT,
  difficulty        TEXT,
  priority          integer,
  proposed_solution TEXT,
  status            TEXT,
  implemented_at    timestamptz,
  result            TEXT,

  imported_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT geo_lab_opportunities_source_unique UNIQUE (organization_id, source_row_id)
);

CREATE INDEX IF NOT EXISTS geo_lab_opportunities_org_priority_idx
  ON geo_lab_opportunities (organization_id, priority DESC NULLS LAST);

ALTER TABLE geo_lab_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geo_lab_opportunities_org_isolation ON geo_lab_opportunities;
CREATE POLICY geo_lab_opportunities_org_isolation ON geo_lab_opportunities
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- ============================================================================
-- 8. GEO_LAB_JOBS -- jobs submitted to the Lab (spec Phase 6).
--    Read-only jobs run on the Lab side without approval. Any job that could
--    touch production or spend money is stored as pending_approval and is not
--    executed until an owner approves it in the Lab. Headquarters records the
--    Lab's answer verbatim so the UI never claims a job ran when it did not.
-- ============================================================================
CREATE TABLE IF NOT EXISTS geo_lab_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  lab_job_id        TEXT NOT NULL,
  kind              TEXT NOT NULL,
  params            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL,
  requires_approval boolean NOT NULL DEFAULT false,
  requested_by      TEXT,
  message           TEXT,
  result            jsonb,
  error             TEXT,

  submitted_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT geo_lab_jobs_unique UNIQUE (organization_id, lab_job_id)
);

CREATE INDEX IF NOT EXISTS geo_lab_jobs_org_submitted_idx
  ON geo_lab_jobs (organization_id, submitted_at DESC);

ALTER TABLE geo_lab_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS geo_lab_jobs_org_isolation ON geo_lab_jobs;
CREATE POLICY geo_lab_jobs_org_isolation ON geo_lab_jobs
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

COMMIT;
