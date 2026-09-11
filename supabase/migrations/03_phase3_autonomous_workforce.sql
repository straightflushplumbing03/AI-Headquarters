-- Phase 3: Autonomous Business Growth Workforce
-- Agent Registry, Capabilities, Tasks, Workflows, Knowledge

-- Agent Registry
CREATE TABLE IF NOT EXISTS agent_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  role TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ceo', 'research', 'strategist', 'implementer', 'analyst', 'learning')),
  system_prompt TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  autonomy_level INTEGER DEFAULT 2 CHECK (autonomy_level >= 1 AND autonomy_level <= 5),
  approval_required BOOLEAN DEFAULT true,
  monthly_budget_limit NUMERIC(10, 2),
  task_budget_limit NUMERIC(10, 2),
  max_concurrent_tasks INTEGER DEFAULT 3,
  retry_attempts INTEGER DEFAULT 3,
  performance_metrics JSONB,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_registry_org_id ON agent_registry(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_registry_type ON agent_registry(type);
CREATE INDEX IF NOT EXISTS idx_agent_registry_status ON agent_registry(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_registry_unique ON agent_registry(organization_id, name, version);

-- Agent Capabilities
CREATE TABLE IF NOT EXISTS agent_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agent_registry(id) ON DELETE CASCADE,
  capability_name TEXT NOT NULL,
  capability_type TEXT NOT NULL CHECK (capability_type IN ('read', 'write', 'execute', 'approve', 'delegate')),
  resource_type TEXT NOT NULL,
  requires_approval BOOLEAN DEFAULT false,
  conditions JSONB,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capabilities_agent_id ON agent_capabilities(agent_id);
CREATE INDEX IF NOT EXISTS idx_capabilities_org_id ON agent_capabilities(organization_id);
CREATE INDEX IF NOT EXISTS idx_capabilities_type ON agent_capabilities(capability_type);

-- Enhanced Tasks (extends Phase 2 tasks)
CREATE TABLE IF NOT EXISTS task_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  steps JSONB NOT NULL,
  created_by UUID REFERENCES agents(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'draft')),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_org_id ON task_workflows(organization_id);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON task_workflows(status);

-- Task with extended properties
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES task_workflows(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority_score NUMERIC(10, 2);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS depends_on UUID REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_required BOOLEAN DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS approval_status TEXT CHECK (approval_status IN ('pending', 'approved', 'rejected', 'expired'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS evidence TEXT[];
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS learning JSONB;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC(10, 6);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(10, 6);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS confidence_score NUMERIC(3, 2);

CREATE INDEX IF NOT EXISTS idx_tasks_priority_score ON tasks(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_depends_on ON tasks(depends_on);
CREATE INDEX IF NOT EXISTS idx_tasks_approval_status ON tasks(approval_status);

-- Opportunity Registry
CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT,
  potential_impact NUMERIC(10, 2),
  confidence_score NUMERIC(3, 2),
  effort_estimate INTEGER,
  priority_score NUMERIC(10, 2),
  status TEXT DEFAULT 'identified' CHECK (status IN ('identified', 'evaluated', 'planned', 'in_progress', 'completed', 'rejected')),
  discovered_by UUID REFERENCES agent_registry(id) ON DELETE SET NULL,
  recommended_action TEXT,
  evidence JSONB,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunities_org_id ON opportunities(organization_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_priority_score ON opportunities(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_category ON opportunities(category);

-- Competitive Intelligence
CREATE TABLE IF NOT EXISTS competitive_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  competitor_name TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  finding TEXT NOT NULL,
  source TEXT,
  category TEXT,
  importance TEXT CHECK (importance IN ('low', 'medium', 'high', 'critical')),
  opportunity TEXT,
  recommended_action TEXT,
  confidence NUMERIC(3, 2),
  discovered_by UUID REFERENCES agent_registry(id) ON DELETE SET NULL,
  previous_value TEXT,
  is_change BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_competitive_org_id ON competitive_intelligence(organization_id);
CREATE INDEX IF NOT EXISTS idx_competitive_competitor ON competitive_intelligence(competitor_name);
CREATE INDEX IF NOT EXISTS idx_competitive_importance ON competitive_intelligence(importance);
CREATE INDEX IF NOT EXISTS idx_competitive_created_at ON competitive_intelligence(created_at DESC);

-- SEO Opportunities
CREATE TABLE IF NOT EXISTS seo_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  location TEXT,
  search_volume INTEGER,
  difficulty NUMERIC(3, 2),
  current_ranking INTEGER,
  opportunity_type TEXT CHECK (opportunity_type IN ('keyword', 'content_gap', 'topic_cluster', 'technical', 'local', 'schema', 'link', 'page_improvement')),
  estimated_traffic INTEGER,
  estimated_revenue_impact NUMERIC(10, 2),
  recommendation TEXT,
  priority_score NUMERIC(10, 2),
  status TEXT DEFAULT 'identified' CHECK (status IN ('identified', 'in_progress', 'implemented', 'rejected')),
  discovered_by UUID REFERENCES agent_registry(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seo_opp_org_id ON seo_opportunities(organization_id);
CREATE INDEX IF NOT EXISTS idx_seo_opp_keyword ON seo_opportunities(keyword);
CREATE INDEX IF NOT EXISTS idx_seo_opp_priority ON seo_opportunities(priority_score DESC);

-- Knowledge System
CREATE TABLE IF NOT EXISTS organizational_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  knowledge_type TEXT NOT NULL CHECK (knowledge_type IN ('finding', 'strategy', 'learning', 'outcome', 'best_practice', 'warning')),
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  source_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  confidence NUMERIC(3, 2),
  created_by UUID REFERENCES agent_registry(id) ON DELETE SET NULL,
  tags TEXT[],
  embeddings_pending BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_org_id ON organizational_knowledge(organization_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_type ON organizational_knowledge(knowledge_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON organizational_knowledge(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_tags ON organizational_knowledge USING GIN(tags);

-- Task Outcomes with Learning
ALTER TABLE task_outcomes ADD COLUMN IF NOT EXISTS inference_confidence NUMERIC(3, 2);
ALTER TABLE task_outcomes ADD COLUMN IF NOT EXISTS recommendation_confidence NUMERIC(3, 2);
ALTER TABLE task_outcomes ADD COLUMN IF NOT EXISTS knowledge_generated TEXT[];
ALTER TABLE task_outcomes ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES task_workflows(id) ON DELETE SET NULL;

-- Workflow Executions
CREATE TABLE IF NOT EXISTS workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES task_workflows(id) ON DELETE CASCADE,
  initiated_by UUID REFERENCES agent_registry(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
  current_step INTEGER DEFAULT 0,
  total_steps INTEGER,
  execution_context JSONB,
  error_log TEXT[],
  total_cost NUMERIC(10, 6),
  started_at TIMESTAMP DEFAULT now(),
  completed_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_exec_org_id ON workflow_executions(organization_id);
CREATE INDEX IF NOT EXISTS idx_workflow_exec_status ON workflow_executions(status);
CREATE INDEX IF NOT EXISTS idx_workflow_exec_workflow_id ON workflow_executions(workflow_id);

-- Scheduled Jobs
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agent_registry(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'on_demand')),
  schedule_cron TEXT,
  next_run_at TIMESTAMP,
  last_run_at TIMESTAMP,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  max_duration_minutes INTEGER DEFAULT 60,
  task_template JSONB,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_org_id ON scheduled_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(next_run_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status ON scheduled_jobs(status);

-- External Data Connectors
CREATE TABLE IF NOT EXISTS external_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connector_type TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  credentials_encrypted TEXT,
  permissions TEXT[],
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error', 'paused')),
  last_sync TIMESTAMP,
  error_message TEXT,
  usage_stats JSONB,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connectors_org_id ON external_connectors(organization_id);
CREATE INDEX IF NOT EXISTS idx_connectors_provider ON external_connectors(provider);
CREATE INDEX IF NOT EXISTS idx_connectors_status ON external_connectors(status);

-- RLS Policies for new tables

ALTER TABLE agent_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_registry_org_isolation" ON agent_registry;
CREATE POLICY "agent_registry_org_isolation"
  ON agent_registry
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE agent_capabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_capabilities_org_isolation" ON agent_capabilities;
CREATE POLICY "agent_capabilities_org_isolation"
  ON agent_capabilities
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE task_workflows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_workflows_org_isolation" ON task_workflows;
CREATE POLICY "task_workflows_org_isolation"
  ON task_workflows
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "opportunities_org_isolation" ON opportunities;
CREATE POLICY "opportunities_org_isolation"
  ON opportunities
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE competitive_intelligence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "competitive_intelligence_org_isolation" ON competitive_intelligence;
CREATE POLICY "competitive_intelligence_org_isolation"
  ON competitive_intelligence
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE seo_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "seo_opportunities_org_isolation" ON seo_opportunities;
CREATE POLICY "seo_opportunities_org_isolation"
  ON seo_opportunities
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE organizational_knowledge ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "organizational_knowledge_org_isolation" ON organizational_knowledge;
CREATE POLICY "organizational_knowledge_org_isolation"
  ON organizational_knowledge
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE workflow_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workflow_executions_org_isolation" ON workflow_executions;
CREATE POLICY "workflow_executions_org_isolation"
  ON workflow_executions
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scheduled_jobs_org_isolation" ON scheduled_jobs;
CREATE POLICY "scheduled_jobs_org_isolation"
  ON scheduled_jobs
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE external_connectors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "external_connectors_org_isolation" ON external_connectors;
CREATE POLICY "external_connectors_org_isolation"
  ON external_connectors
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
