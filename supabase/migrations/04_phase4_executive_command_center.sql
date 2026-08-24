-- Phase 4: Executive Command Center & Real-World Business Execution
-- Database extensions for dashboards, KPIs, decisions, and business outcomes

-- Business KPI Tracking
CREATE TABLE IF NOT EXISTS business_kpis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kpi_type TEXT NOT NULL CHECK (kpi_type IN ('seo', 'website', 'business', 'custom')),
  name TEXT NOT NULL,
  value NUMERIC(15, 2),
  previous_value NUMERIC(15, 2),
  trend TEXT CHECK (trend IN ('improving', 'declining', 'stable')),
  unit TEXT,
  description TEXT,
  data_source TEXT,
  last_updated TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_kpis_org_id ON business_kpis(organization_id);
CREATE INDEX idx_kpis_type ON business_kpis(kpi_type);
CREATE INDEX idx_kpis_last_updated ON business_kpis(last_updated DESC);

-- Executive Decisions Log
CREATE TABLE IF NOT EXISTS executive_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  decision_title TEXT NOT NULL,
  decision_content TEXT NOT NULL,
  decision_date TIMESTAMP DEFAULT now(),
  made_by UUID REFERENCES agents(id) ON DELETE SET NULL,
  reason TEXT,
  evidence JSONB,
  alternatives_considered TEXT[],
  expected_outcome TEXT,
  confidence NUMERIC(3, 2),
  actions_created TEXT[],
  actual_outcome TEXT,
  outcome_measured BOOLEAN DEFAULT false,
  outcome_date TIMESTAMP,
  lesson_learned TEXT,
  searchable_text TEXT,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_decisions_org_id ON executive_decisions(organization_id);
CREATE INDEX idx_decisions_date ON executive_decisions(decision_date DESC);
CREATE INDEX idx_decisions_search ON executive_decisions USING GIN(to_tsvector('english', searchable_text));

-- Daily Briefings
CREATE TABLE IF NOT EXISTS daily_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  briefing_date DATE NOT NULL,
  yesterday_summary TEXT,
  today_summary TEXT,
  alerts_summary TEXT,
  ceo_recommendation TEXT,
  metrics JSONB,
  generated_at TIMESTAMP DEFAULT now(),
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_briefings_org_id ON daily_briefings(organization_id);
CREATE INDEX idx_briefings_date ON daily_briefings(briefing_date DESC);
CREATE UNIQUE INDEX idx_briefings_unique ON daily_briefings(organization_id, briefing_date);

-- Website Pages Intelligence
CREATE TABLE IF NOT EXISTS website_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  meta_description TEXT,
  headers JSONB,
  content_word_count INTEGER,
  internal_links INTEGER,
  external_links INTEGER,
  has_schema BOOLEAN,
  has_canonical BOOLEAN,
  indexable BOOLEAN,
  rank_position INTEGER,
  search_impressions INTEGER,
  search_clicks INTEGER,
  last_analyzed TIMESTAMP,
  issues JSONB,
  opportunities JSONB,
  content_gaps TEXT[],
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_pages_org_id ON website_pages(organization_id);
CREATE INDEX idx_pages_rank ON website_pages(rank_position);
CREATE INDEX idx_pages_url ON website_pages(url);

-- GitHub Integration Audit Trail
CREATE TABLE IF NOT EXISTS github_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  request_id TEXT UNIQUE,
  agent_id UUID REFERENCES agent_registry(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high')),
  branch_name TEXT NOT NULL,
  files_changed TEXT[],
  before_content JSONB,
  after_content JSONB,
  diff TEXT,
  approval_required BOOLEAN,
  approval_status TEXT CHECK (approval_status IN ('pending', 'approved', 'rejected', 'expired')),
  approved_by UUID,
  approved_at TIMESTAMP,
  pr_number INTEGER,
  pr_url TEXT,
  merged BOOLEAN DEFAULT false,
  merged_at TIMESTAMP,
  deployment_status TEXT CHECK (deployment_status IN ('pending', 'deployed', 'failed', 'rolled_back')),
  deployed_at TIMESTAMP,
  result_measured BOOLEAN DEFAULT false,
  result TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_github_org_id ON github_changes(organization_id);
CREATE INDEX idx_github_status ON github_changes(approval_status);
CREATE INDEX idx_github_risk ON github_changes(risk_level);
CREATE INDEX idx_github_created ON github_changes(created_at DESC);

-- SEO Experiments
CREATE TABLE IF NOT EXISTS seo_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  hypothesis TEXT NOT NULL,
  change_description TEXT NOT NULL,
  page_url TEXT,
  change_type TEXT,
  baseline_value NUMERIC(15, 4),
  baseline_metric TEXT,
  expected_result TEXT,
  confidence NUMERIC(3, 2),
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  actual_result TEXT CHECK (actual_result IN ('improved', 'declined', 'neutral', 'inconclusive')),
  result_value NUMERIC(15, 4),
  change_percent NUMERIC(10, 2),
  significant BOOLEAN,
  learning_recorded TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_experiments_org_id ON seo_experiments(organization_id);
CREATE INDEX idx_experiments_status ON seo_experiments(actual_result);
CREATE INDEX idx_experiments_created ON seo_experiments(created_at DESC);

-- Competitor Alerts
CREATE TABLE IF NOT EXISTS competitor_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_name TEXT NOT NULL,
  alert_type TEXT,
  finding TEXT,
  opportunity TEXT,
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  action_recommended TEXT,
  workflow_created_id UUID REFERENCES task_workflows(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'acted_on', 'dismissed')),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_alerts_org_id ON competitor_alerts(organization_id);
CREATE INDEX idx_alerts_severity ON competitor_alerts(severity);
CREATE INDEX idx_alerts_status ON competitor_alerts(status);
CREATE INDEX idx_alerts_created ON competitor_alerts(created_at DESC);

-- Agent Performance Metrics
CREATE TABLE IF NOT EXISTS agent_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agent_registry(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  tasks_completed INTEGER DEFAULT 0,
  tasks_failed INTEGER DEFAULT 0,
  average_execution_time_seconds NUMERIC(10, 2),
  total_cost NUMERIC(10, 6),
  opportunities_discovered INTEGER DEFAULT 0,
  recommendations_accepted INTEGER DEFAULT 0,
  recommendations_rejected INTEGER DEFAULT 0,
  outcomes_generated INTEGER DEFAULT 0,
  accuracy_score NUMERIC(3, 2),
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_agent_perf_org_id ON agent_performance(organization_id);
CREATE INDEX idx_agent_perf_agent_id ON agent_performance(agent_id);
CREATE INDEX idx_agent_perf_date ON agent_performance(metric_date DESC);

-- Organization Company Profile
CREATE TABLE IF NOT EXISTS company_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  brand_position TEXT,
  primary_specialties TEXT[],
  strategic_market TEXT,
  service_areas TEXT[],
  brand_values TEXT[],
  primary_competitors TEXT[],
  strategic_objectives TEXT[],
  company_context TEXT,
  additional_info JSONB,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX idx_profile_org_id ON company_profiles(organization_id);
CREATE UNIQUE INDEX idx_profile_unique ON company_profiles(organization_id);

-- RLS Policies for new tables

ALTER TABLE business_kpis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kpis_org_isolation" ON business_kpis USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);

ALTER TABLE executive_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "decisions_org_isolation" ON executive_decisions USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);

ALTER TABLE daily_briefings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "briefings_org_isolation" ON daily_briefings USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);

ALTER TABLE website_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pages_org_isolation" ON website_pages USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);

ALTER TABLE github_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "github_org_isolation" ON github_changes USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);

ALTER TABLE seo_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "experiments_org_isolation" ON seo_experiments USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);

ALTER TABLE competitor_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alerts_org_isolation" ON competitor_alerts USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);

ALTER TABLE agent_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perf_org_isolation" ON agent_performance USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);

ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profile_org_isolation" ON company_profiles USING (
  organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
);
