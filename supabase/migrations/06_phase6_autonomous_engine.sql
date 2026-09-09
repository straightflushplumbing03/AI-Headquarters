-- Phase 6: Autonomous Decision & Action Engine
-- Enables AI to make decisions, execute actions, track outcomes

-- Table 1: AUTONOMOUS_DECISIONS
-- Every decision the AI makes is recorded here for audit, learning, and approval
CREATE TABLE IF NOT EXISTS autonomous_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Decision metadata
  decision_type TEXT NOT NULL CHECK (decision_type IN (
    'revenue_opportunity', 'lead_quality', 'conversion_improvement', 'churn_prevention',
    'marketing_strategy', 'seo_action', 'competitive_response', 'service_demand',
    'cost_reduction', 'operational_improvement', 'customer_retention', 'custom'
  )),

  -- Decision details
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reasoning TEXT NOT NULL,

  -- Trigger and evidence
  trigger_event TEXT,
  trigger_data JSONB,
  supporting_evidence JSONB NOT NULL,
  relevant_metrics JSONB,

  -- Confidence and impact
  confidence_score DECIMAL(5,2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  confidence_level TEXT CHECK (confidence_level IN ('very_low', 'low', 'medium', 'high', 'very_high')),
  
  expected_impact_type TEXT, -- 'revenue', 'cost', 'lead', 'conversion', 'retention'
  expected_revenue_impact NUMERIC(12,2),
  estimated_cost NUMERIC(10,2),
  estimated_roi DECIMAL(8,2),

  -- Risk assessment
  risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  risk_description TEXT,

  -- Recommended action
  recommended_action TEXT NOT NULL,
  action_parameters JSONB,

  -- Authorization
  approval_level TEXT CHECK (approval_level IN ('autonomous', 'controlled', 'approval_required', 'human_only')),
  approval_required BOOLEAN,
  approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'expired')),
  approved_by TEXT,
  approval_notes TEXT,
  approved_at TIMESTAMP WITH TIME ZONE,

  -- Execution
  execution_status TEXT DEFAULT 'not_executed' CHECK (execution_status IN ('not_executed', 'queued', 'executing', 'executed', 'failed', 'rolled_back')),
  executed_by TEXT, -- Agent ID or user
  executed_at TIMESTAMP WITH TIME ZONE,

  -- Outcome
  actual_outcome TEXT,
  actual_revenue_impact NUMERIC(12,2),
  actual_cost NUMERIC(10,2),
  actual_roi DECIMAL(8,2),
  success BOOLEAN,
  outcome_measured BOOLEAN DEFAULT FALSE,
  outcome_measured_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  related_prediction_ids uuid[],
  related_opportunity_ids uuid[],
  related_recommendation_ids uuid[],

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT decisions_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 2: AUTONOMOUS_ACTIONS
-- Tracks every action executed by the AI system
CREATE TABLE IF NOT EXISTS autonomous_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES autonomous_decisions(id) ON DELETE SET NULL,

  -- Action classification
  action_type TEXT NOT NULL CHECK (action_type IN (
    'generate_report', 'create_task', 'send_alert', 'update_priority', 'launch_campaign',
    'adjust_budget', 'create_content', 'schedule_execution', 'modify_workflow', 'custom'
  )),

  title TEXT NOT NULL,
  description TEXT,

  -- Payload and parameters
  payload JSONB NOT NULL,
  parameters JSONB,

  -- Authorization
  authorization_level TEXT NOT NULL CHECK (authorization_level IN ('level_1', 'level_2', 'level_3', 'level_4')),
  risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),

  -- Execution control
  execution_status TEXT DEFAULT 'queued' CHECK (execution_status IN ('queued', 'scheduled', 'executing', 'completed', 'failed', 'cancelled', 'rolled_back')),
  scheduled_for TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,

  -- Retry logic
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_error TEXT,
  error_details JSONB,

  -- Idempotency
  idempotency_key TEXT UNIQUE,
  
  -- Result
  result JSONB,
  result_summary TEXT,
  success BOOLEAN,

  -- Tracking
  executed_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT actions_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 3: APPROVAL_REQUESTS
-- Actions requiring human approval
CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES autonomous_decisions(id) ON DELETE CASCADE,
  action_id uuid REFERENCES autonomous_actions(id) ON DELETE SET NULL,

  -- Request details
  request_type TEXT NOT NULL CHECK (request_type IN ('decision', 'action', 'budget', 'policy', 'custom')),
  title TEXT NOT NULL,
  description TEXT,

  -- Evidence and reasoning
  evidence JSONB,
  reasoning TEXT,
  expected_impact TEXT,
  risk_assessment TEXT,

  -- AI recommendation
  ai_recommendation TEXT,
  recommendation_confidence DECIMAL(5,2),
  alternative_options JSONB,

  -- Approval workflow
  approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'modified', 'deferred')),
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  response_deadline TIMESTAMP WITH TIME ZONE,
  
  approved_by TEXT,
  approval_notes TEXT,
  approved_at TIMESTAMP WITH TIME ZONE,
  
  -- Modifications
  modifications JSONB,
  modified_by TEXT,
  modified_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT approvals_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 4: ACTION_QUEUE
-- Queue for pending and scheduled actions
CREATE TABLE IF NOT EXISTS action_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES autonomous_actions(id) ON DELETE CASCADE,

  -- Queue status
  queue_status TEXT DEFAULT 'pending' CHECK (queue_status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  priority INTEGER DEFAULT 50, -- 1-100, higher = more urgent
  
  -- Timing
  queued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  scheduled_for TIMESTAMP WITH TIME ZONE,
  processing_started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,

  -- Rate limiting
  rate_limit_category TEXT,
  rate_limit_remaining INTEGER,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT queue_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 5: ACTION_OUTCOMES
-- Tracks results and learnings from actions
CREATE TABLE IF NOT EXISTS action_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action_id uuid NOT NULL REFERENCES autonomous_actions(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES autonomous_decisions(id) ON DELETE SET NULL,

  -- Outcome
  outcome_type TEXT NOT NULL CHECK (outcome_type IN ('success', 'partial_success', 'failure', 'side_effect')),
  description TEXT,

  -- Measurement
  measured_at TIMESTAMP WITH TIME ZONE,
  measurement_method TEXT,
  measurement_source TEXT,

  -- Business metrics
  revenue_generated NUMERIC(12,2),
  cost_incurred NUMERIC(10,2),
  roi DECIMAL(8,2),
  
  -- Effectiveness
  effectiveness_score DECIMAL(5,2),
  confidence_in_measurement DECIMAL(5,2),

  -- Learnings
  learnings TEXT,
  unexpected_results TEXT,
  contributing_factors JSONB,

  -- Recommendations for next time
  improvement_suggestions TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT outcomes_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 6: DECISION_RULES
-- Business rules for autonomous decision-making
CREATE TABLE IF NOT EXISTS decision_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Rule definition
  rule_name TEXT NOT NULL,
  description TEXT,
  rule_category TEXT,
  
  -- Trigger conditions
  trigger_condition JSONB NOT NULL,
  condition_logic TEXT, -- 'and', 'or'
  
  -- Decision
  decision_type TEXT,
  decision_action TEXT,
  
  -- Authorization
  auto_execute BOOLEAN DEFAULT FALSE,
  require_approval BOOLEAN DEFAULT TRUE,
  approval_level TEXT CHECK (approval_level IN ('autonomous', 'controlled', 'approval_required')),
  
  -- Financial limits
  max_autonomous_impact NUMERIC(10,2),
  max_autonomous_cost NUMERIC(10,2),
  
  -- Status
  enabled BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 50,
  
  -- Metadata
  created_by TEXT,
  last_modified_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT rules_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 7: AUTONOMOUS_WORKFLOWS
-- Multi-step autonomous workflows
CREATE TABLE IF NOT EXISTS autonomous_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Workflow definition
  name TEXT NOT NULL,
  description TEXT,
  workflow_type TEXT,
  
  -- Steps
  steps JSONB NOT NULL, -- Array of step definitions
  step_count INTEGER,
  
  -- Triggers
  trigger_events TEXT[],
  trigger_condition JSONB,
  
  -- Execution
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived', 'testing')),
  auto_execute BOOLEAN DEFAULT FALSE,
  require_approval_per_step BOOLEAN DEFAULT FALSE,
  require_approval_final BOOLEAN DEFAULT TRUE,
  
  -- Performance
  executions_total INTEGER DEFAULT 0,
  executions_successful INTEGER DEFAULT 0,
  executions_failed INTEGER DEFAULT 0,
  average_duration_seconds INTEGER,
  
  -- Metadata
  created_by TEXT,
  last_executed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT workflows_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 8: AUTONOMOUS_WORKFLOW_EXECUTIONS
-- Track execution of workflows
CREATE TABLE IF NOT EXISTS autonomous_workflow_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES autonomous_workflows(id) ON DELETE CASCADE,

  -- Execution context
  execution_status TEXT DEFAULT 'running' CHECK (execution_status IN ('running', 'completed', 'failed', 'paused', 'cancelled')),
  current_step INTEGER,
  total_steps INTEGER,
  
  -- Timeline
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER,
  
  -- Results
  results JSONB,
  errors JSONB,
  
  -- Context
  triggered_by_event TEXT,
  triggered_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT workflow_exec_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_org ON autonomous_decisions(organization_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_status ON autonomous_decisions(execution_status);
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_confidence ON autonomous_decisions(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_type ON autonomous_decisions(decision_type);
CREATE INDEX IF NOT EXISTS idx_autonomous_decisions_created ON autonomous_decisions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_autonomous_actions_org ON autonomous_actions(organization_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_actions_status ON autonomous_actions(execution_status);
CREATE INDEX IF NOT EXISTS idx_autonomous_actions_decision ON autonomous_actions(decision_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_actions_type ON autonomous_actions(action_type);

CREATE INDEX IF NOT EXISTS idx_approval_requests_org ON approval_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_requests_task ON approval_requests(task_id);

CREATE INDEX IF NOT EXISTS idx_action_queue_org ON action_queue(organization_id);
CREATE INDEX IF NOT EXISTS idx_action_queue_status ON action_queue(queue_status);
CREATE INDEX IF NOT EXISTS idx_action_queue_priority ON action_queue(priority DESC);

CREATE INDEX IF NOT EXISTS idx_action_outcomes_org ON action_outcomes(organization_id);
CREATE INDEX IF NOT EXISTS idx_action_outcomes_action ON action_outcomes(action_id);
CREATE INDEX IF NOT EXISTS idx_action_outcomes_outcome ON action_outcomes(outcome_type);

CREATE INDEX IF NOT EXISTS idx_decision_rules_org ON decision_rules(organization_id);
CREATE INDEX IF NOT EXISTS idx_decision_rules_enabled ON decision_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_decision_rules_category ON decision_rules(rule_category);

CREATE INDEX IF NOT EXISTS idx_autonomous_workflows_org ON autonomous_workflows(organization_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_workflows_status ON autonomous_workflows(status);

CREATE INDEX IF NOT EXISTS idx_workflow_executions_org ON autonomous_workflow_executions(organization_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON autonomous_workflow_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON autonomous_workflow_executions(execution_status);

-- ROW LEVEL SECURITY
ALTER TABLE autonomous_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS autonomous_decisions_org_isolation ON autonomous_decisions;
CREATE POLICY autonomous_decisions_org_isolation ON autonomous_decisions
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE autonomous_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS autonomous_actions_org_isolation ON autonomous_actions;
CREATE POLICY autonomous_actions_org_isolation ON autonomous_actions
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approval_requests_org_isolation ON approval_requests;
CREATE POLICY approval_requests_org_isolation ON approval_requests
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE action_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_queue_org_isolation ON action_queue;
CREATE POLICY action_queue_org_isolation ON action_queue
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE action_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_outcomes_org_isolation ON action_outcomes;
CREATE POLICY action_outcomes_org_isolation ON action_outcomes
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE decision_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS decision_rules_org_isolation ON decision_rules;
CREATE POLICY decision_rules_org_isolation ON decision_rules
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE autonomous_workflows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS autonomous_workflows_org_isolation ON autonomous_workflows;
CREATE POLICY autonomous_workflows_org_isolation ON autonomous_workflows
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE autonomous_workflow_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS autonomous_workflow_executions_org_isolation ON autonomous_workflow_executions;
CREATE POLICY autonomous_workflow_executions_org_isolation ON autonomous_workflow_executions
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON autonomous_decisions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON autonomous_actions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON approval_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON action_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON action_outcomes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON decision_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON autonomous_workflows TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON autonomous_workflow_executions TO authenticated;
