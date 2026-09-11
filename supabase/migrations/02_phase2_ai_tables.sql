-- Phase 2: AI Workforce Engine Database Extensions
-- Add tables for AI execution, cost tracking, goals, and approvals

-- AI Provider Configuration (encrypted storage)
CREATE TABLE IF NOT EXISTS ai_provider_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'pending')),
  model TEXT NOT NULL,
  api_key_encrypted TEXT, -- encrypted in application
  is_configured BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'pending' CHECK (status IN ('active', 'pending', 'error')),
  last_verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_org_id ON ai_provider_config(organization_id);

-- AI Execution Logs (audit trail)
CREATE TABLE IF NOT EXISTS ai_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(10, 6) NOT NULL DEFAULT 0,
  actual_cost NUMERIC(10, 6),
  execution_time_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'partial')),
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_org_id ON ai_execution_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_agent_id ON ai_execution_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_task_id ON ai_execution_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_ai_logs_created_at ON ai_execution_logs(created_at DESC);

-- AI Usage Limits (per organization)
CREATE TABLE IF NOT EXISTS ai_usage_limits (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  monthly_budget NUMERIC(10, 2) NOT NULL DEFAULT 100,
  agent_budget NUMERIC(10, 2),
  task_budget NUMERIC(10, 2),
  current_spend NUMERIC(10, 6) NOT NULL DEFAULT 0,
  reset_date DATE NOT NULL,
  paused BOOLEAN DEFAULT false,
  pause_reason TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Agent System Prompts
CREATE TABLE IF NOT EXISTS agent_system_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  purpose TEXT NOT NULL,
  constraints TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  system_prompt TEXT NOT NULL,
  autonomy_level INTEGER DEFAULT 1 CHECK (autonomy_level >= 1 AND autonomy_level <= 5),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prompts_org_id ON agent_system_prompts(organization_id);
CREATE INDEX IF NOT EXISTS idx_prompts_agent_id ON agent_system_prompts(agent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_unique ON agent_system_prompts(agent_id);

-- Company Goals
CREATE TABLE IF NOT EXISTS company_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  target_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
  metrics JSONB,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_org_id ON company_goals(organization_id);
CREATE INDEX IF NOT EXISTS idx_goals_status ON company_goals(status);

-- Approval Requests
CREATE TABLE IF NOT EXISTS approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('task_execution', 'knowledge_storage', 'external_action', 'budget_exception')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  proposed_action TEXT NOT NULL,
  metadata JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  created_at TIMESTAMP DEFAULT now(),
  expires_at TIMESTAMP NOT NULL,
  responded_at TIMESTAMP,
  responded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  response_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_approvals_org_id ON approval_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approvals_task_id ON approval_requests(task_id);
CREATE INDEX IF NOT EXISTS idx_approvals_expires_at ON approval_requests(expires_at);

-- Task Outcomes (learning)
CREATE TABLE IF NOT EXISTS task_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  objective TEXT NOT NULL,
  result TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  learnings TEXT[] DEFAULT ARRAY[]::TEXT[],
  metrics JSONB,
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outcomes_org_id ON task_outcomes(organization_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_task_id ON task_outcomes(task_id);
CREATE INDEX IF NOT EXISTS idx_outcomes_agent_id ON task_outcomes(agent_id);

-- Row Level Security for new tables

-- ai_provider_config RLS
ALTER TABLE ai_provider_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_provider_org_isolation" ON ai_provider_config;
CREATE POLICY "ai_provider_org_isolation"
  ON ai_provider_config
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- ai_execution_logs RLS
ALTER TABLE ai_execution_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_logs_org_isolation" ON ai_execution_logs;
CREATE POLICY "ai_logs_org_isolation"
  ON ai_execution_logs
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- ai_usage_limits RLS
ALTER TABLE ai_usage_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_limits_org_isolation" ON ai_usage_limits;
CREATE POLICY "ai_limits_org_isolation"
  ON ai_usage_limits
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- agent_system_prompts RLS
ALTER TABLE agent_system_prompts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prompts_org_isolation" ON agent_system_prompts;
CREATE POLICY "prompts_org_isolation"
  ON agent_system_prompts
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- company_goals RLS
ALTER TABLE company_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "goals_org_isolation" ON company_goals;
CREATE POLICY "goals_org_isolation"
  ON company_goals
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- approval_requests RLS
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "approvals_org_isolation" ON approval_requests;
CREATE POLICY "approvals_org_isolation"
  ON approval_requests
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- task_outcomes RLS
ALTER TABLE task_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "outcomes_org_isolation" ON task_outcomes;
CREATE POLICY "outcomes_org_isolation"
  ON task_outcomes
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
