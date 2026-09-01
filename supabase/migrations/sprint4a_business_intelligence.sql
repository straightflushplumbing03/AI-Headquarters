-- Sprint 4A: Business Intelligence Foundation
-- Idempotent migration — safe to run multiple times.
-- Reuses existing company_profiles and website_pages tables.
-- Only adds columns/tables that are genuinely new.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Extend company_profiles (reused Phase 4 table)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS primary_location TEXT;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Extend website_pages (reused Phase 4 table) with crawl-specific fields
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE website_pages
  ADD COLUMN IF NOT EXISTS http_status   INTEGER,
  ADD COLUMN IF NOT EXISTS canonical_url TEXT,
  ADD COLUMN IF NOT EXISTS h1            TEXT,
  ADD COLUMN IF NOT EXISTS h1_count      INTEGER DEFAULT 0;

-- Unique URL per org (prevent duplicates)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'website_pages'
      AND indexname = 'idx_website_pages_org_url_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_website_pages_org_url_unique
      ON website_pages(organization_id, url);
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Crawl configuration per organization
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS website_crawl_config (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain                  TEXT NOT NULL,          -- hostname only, e.g. "example.com"
  seed_url                TEXT NOT NULL,          -- starting URL for crawl
  max_pages               INTEGER NOT NULL DEFAULT 25,
  request_timeout_ms      INTEGER NOT NULL DEFAULT 10000,
  crawl_cooldown_minutes  INTEGER NOT NULL DEFAULT 60,
  enabled                 BOOLEAN NOT NULL DEFAULT TRUE,
  last_crawled_at         TIMESTAMP WITH TIME ZONE,
  created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT crawl_config_org_unique UNIQUE (organization_id)
);

CREATE INDEX IF NOT EXISTS idx_crawl_config_org ON website_crawl_config(organization_id);

ALTER TABLE website_crawl_config ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'website_crawl_config' AND policyname = 'crawl_config_org_isolation'
  ) THEN
    CREATE POLICY crawl_config_org_isolation ON website_crawl_config
      FOR ALL USING (
        organization_id IN (
          SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Website crawl snapshots — one record per crawl run
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS website_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  started_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMP WITH TIME ZONE,
  pages_crawled     INTEGER DEFAULT 0,
  pages_added       INTEGER DEFAULT 0,
  pages_removed     INTEGER DEFAULT 0,
  pages_changed     INTEGER DEFAULT 0,
  seo_issues_found  INTEGER DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  error_message     TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_org        ON website_snapshots(organization_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_started_at ON website_snapshots(started_at DESC);

ALTER TABLE website_snapshots ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'website_snapshots' AND policyname = 'snapshots_org_isolation'
  ) THEN
    CREATE POLICY snapshots_org_isolation ON website_snapshots
      FOR ALL USING (
        organization_id IN (
          SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Page-level changes detected between crawl runs
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS website_page_changes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_id     UUID REFERENCES website_snapshots(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  change_type     TEXT NOT NULL CHECK (change_type IN (
    'page_added', 'page_removed',
    'title_changed', 'meta_description_changed', 'h1_changed',
    'http_status_changed', 'canonical_changed', 'indexable_changed',
    'seo_issue_detected', 'seo_issue_resolved'
  )),
  previous_value  TEXT,
  current_value   TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_changes_org        ON website_page_changes(organization_id);
CREATE INDEX IF NOT EXISTS idx_page_changes_snapshot   ON website_page_changes(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_page_changes_created_at ON website_page_changes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_changes_type       ON website_page_changes(change_type);

ALTER TABLE website_page_changes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'website_page_changes' AND policyname = 'page_changes_org_isolation'
  ) THEN
    CREATE POLICY page_changes_org_isolation ON website_page_changes
      FOR ALL USING (
        organization_id IN (
          SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. SEO issue lifecycle tracking (open / resolved)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS website_seo_issues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  issue_type      TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  message         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  detected_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMP WITH TIME ZONE,
  snapshot_id     UUID REFERENCES website_snapshots(id) ON DELETE SET NULL,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT seo_issue_per_url_type UNIQUE (organization_id, url, issue_type)
);

CREATE INDEX IF NOT EXISTS idx_seo_issues_org    ON website_seo_issues(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_issues_status ON website_seo_issues(status);
CREATE INDEX IF NOT EXISTS idx_seo_issues_url    ON website_seo_issues(url);

ALTER TABLE website_seo_issues ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'website_seo_issues' AND policyname = 'seo_issues_org_isolation'
  ) THEN
    CREATE POLICY seo_issues_org_isolation ON website_seo_issues
      FOR ALL USING (
        organization_id IN (
          SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Grants
-- ────────────────────────────────────────────────────────────────────────────
GRANT ALL ON website_crawl_config TO authenticated;
GRANT ALL ON website_snapshots     TO authenticated;
GRANT ALL ON website_page_changes  TO authenticated;
GRANT ALL ON website_seo_issues    TO authenticated;
