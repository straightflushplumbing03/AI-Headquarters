-- Phase 7: Continuous Learning & Self-Optimization
-- Creates infrastructure for the AI system to learn, measure, and improve continuously

-- Table 1: PREDICTION_ACCURACY_LOG
-- Track every prediction and its actual outcome
CREATE TABLE IF NOT EXISTS prediction_accuracy_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prediction_id uuid REFERENCES predictions(id) ON DELETE SET NULL,

  -- Prediction details
  prediction_type TEXT,
  predicted_value NUMERIC(12,2),
  predicted_confidence DECIMAL(5,2),

  -- Actual outcome
  actual_value NUMERIC(12,2),
  measurement_date DATE,
  measured_at TIMESTAMP WITH TIME ZONE,

  -- Accuracy metrics
  error NUMERIC(12,2),
  error_percentage DECIMAL(8,2),
  accuracy_score DECIMAL(5,2),
  mae DECIMAL(8,2),
  mape DECIMAL(8,2),

  -- Model and provider
  model_used TEXT,
  ai_provider TEXT,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,

  -- Learning context
  data_quality_at_time DECIMAL(3,2),
  data_points_used INTEGER,
  time_since_prediction_days INTEGER,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT accuracy_log_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 2: AGENT_PERFORMANCE_METRICS
-- Comprehensive performance tracking for each AI agent
CREATE TABLE IF NOT EXISTS agent_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,

  -- Task tracking
  metric_date DATE NOT NULL,
  tasks_completed INTEGER DEFAULT 0,
  tasks_successful INTEGER DEFAULT 0,
  tasks_failed INTEGER DEFAULT 0,

  -- Rates
  success_rate DECIMAL(5,2),
  failure_rate DECIMAL(5,2),
  accuracy_score DECIMAL(5,2),

  -- Timing
  avg_execution_time_seconds INTEGER,
  total_execution_time_seconds INTEGER,

  -- Business impact
  revenue_generated NUMERIC(12,2),
  cost_incurred NUMERIC(10,2),
  roi DECIMAL(8,2),

  -- Quality
  human_override_count INTEGER DEFAULT 0,
  recommendation_acceptance_rate DECIMAL(5,2),

  -- Learning
  improvement_trend TEXT CHECK (improvement_trend IN ('improving', 'stable', 'declining')),
  notes TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT agent_perf_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT unique_agent_metric_date UNIQUE (organization_id, agent_id, metric_date)
);

-- Table 3: BUSINESS_MEMORY
-- Long-term institutional knowledge
CREATE TABLE IF NOT EXISTS business_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Memory classification
  memory_type TEXT NOT NULL CHECK (memory_type IN (
    'strategy', 'tactic', 'pattern', 'lesson', 'insight', 'opportunity', 'threat', 'strength', 'weakness', 'customer_pattern', 'market_pattern'
  )),

  -- Memory content
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,

  -- Context
  source TEXT,
  source_data JSONB,
  related_to_category TEXT,

  -- Confidence and validity
  confidence DECIMAL(5,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reliability_score DECIMAL(5,2),
  evidence_count INTEGER,

  -- Lifecycle
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_verified_at TIMESTAMP WITH TIME ZONE,
  last_used_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,

  -- Status
  active BOOLEAN DEFAULT TRUE,
  usage_count INTEGER DEFAULT 0,

  CONSTRAINT memory_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 4: COMPETITIVE_INTELLIGENCE
-- Track competitor activities and market changes
CREATE TABLE IF NOT EXISTS competitive_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Observation
  competitor_name TEXT,
  finding_type TEXT CHECK (finding_type IN (
    'website_change', 'seo_change', 'new_service', 'new_content', 'review', 'messaging',
    'offer', 'pricing', 'local_visibility', 'sentiment', 'trend', 'technology'
  )),
  finding TEXT NOT NULL,

  -- Assessment
  importance TEXT CHECK (importance IN ('low', 'medium', 'high', 'critical')),
  threat_level INTEGER CHECK (threat_level >= 0 AND threat_level <= 10),

  -- Response
  recommended_response TEXT,
  action_taken TEXT,
  action_date DATE,

  -- Tracking
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  verified_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'monitoring', 'responded', 'resolved')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT competitive_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 5: STRATEGY_EXPERIMENTS
-- Track A/B tests and strategy variations
CREATE TABLE IF NOT EXISTS strategy_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Experiment definition
  name TEXT NOT NULL,
  description TEXT,
  experiment_type TEXT CHECK (experiment_type IN (
    'marketing', 'seo', 'content', 'conversion', 'retention', 'messaging', 'pricing'
  )),

  -- Variants
  control_variant TEXT NOT NULL,
  test_variant TEXT NOT NULL,
  control_description TEXT,
  test_description TEXT,

  -- Hypothesis
  hypothesis TEXT,
  expected_outcome TEXT,

  -- Execution
  start_date DATE NOT NULL,
  end_date DATE,
  sample_size INTEGER,
  duration_days INTEGER,

  -- Results
  control_result NUMERIC(8,2),
  test_result NUMERIC(8,2),
  improvement_percentage DECIMAL(8,2),
  statistical_confidence DECIMAL(5,2),

  -- Decision
  winner TEXT,
  decision TEXT,
  decision_date DATE,
  implemented BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT experiment_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 6: LEARNING_RECOMMENDATIONS
-- AI-generated improvement recommendations
CREATE TABLE IF NOT EXISTS learning_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Recommendation
  recommendation_type TEXT CHECK (recommendation_type IN (
    'strategy_improvement', 'model_change', 'data_improvement', 'cost_optimization', 'efficiency_gain', 'quality_improvement'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,

  -- Evidence
  evidence JSONB,
  confidence_score DECIMAL(5,2),
  supporting_metrics JSONB,

  -- Impact
  expected_impact TEXT,
  expected_roi DECIMAL(8,2),
  effort_required TEXT,

  -- Status
  status TEXT DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'implemented', 'rejected', 'deferred')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE,

  -- Implementation
  implementation_notes TEXT,
  implemented_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT learning_rec_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 7: SYSTEM_HEALTH_METRICS
-- Self-monitoring for system health and degradation
CREATE TABLE IF NOT EXISTS system_health_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Metric date
  metric_date DATE NOT NULL,

  -- Prediction quality
  avg_prediction_accuracy DECIMAL(5,2),
  prediction_drift DECIMAL(5,2),
  weak_prediction_count INTEGER,

  -- Agent health
  agent_failure_rate DECIMAL(5,2),
  agent_avg_execution_time INTEGER,

  -- Data quality
  data_quality_score DECIMAL(5,2),
  missing_data_points_pct DECIMAL(5,2),

  -- System performance
  api_latency_ms INTEGER,
  action_queue_size INTEGER,
  pending_approvals_count INTEGER,

  -- Anomalies
  anomalies_detected TEXT[],
  alerts JSONB,

  -- Health score
  overall_health_score DECIMAL(5,2),
  health_trend TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT health_metrics_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT unique_health_metric_date UNIQUE (organization_id, metric_date)
);

-- Table 8: AI_PROVIDER_PERFORMANCE
-- Track performance of different AI providers
CREATE TABLE IF NOT EXISTS ai_provider_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Provider info
  provider_name TEXT NOT NULL,
  model_name TEXT,
  task_type TEXT,

  -- Performance metrics
  task_count INTEGER DEFAULT 0,
  success_rate DECIMAL(5,2),
  avg_latency_ms INTEGER,
  cost_per_task DECIMAL(8,4),
  quality_score DECIMAL(5,2),
  reliability_score DECIMAL(5,2),

  -- Cost tracking
  total_tokens_used INTEGER,
  total_cost_dollars NUMERIC(10,2),
  cost_per_outcome NUMERIC(10,2),

  -- Comparisons
  better_than_alternatives TEXT[],
  worse_than_alternatives TEXT[],

  -- Recommendation
  recommended_for TEXT[],
  not_recommended_for TEXT[],

  metric_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT provider_perf_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Table 9: EXECUTIVE_INTELLIGENCE_BRIEFING
-- Daily/weekly AI-generated executive briefings
CREATE TABLE IF NOT EXISTS executive_intelligence_briefing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Briefing period
  briefing_date DATE NOT NULL,
  briefing_period TEXT CHECK (briefing_period IN ('daily', 'weekly', 'monthly')),

  -- What happened
  key_events JSONB,
  significant_changes JSONB,

  -- Why it happened
  root_cause_analysis JSONB,
  contributing_factors JSONB,

  -- What comes next
  forecast JSONB,
  predicted_challenges JSONB,
  predicted_opportunities JSONB,

  -- Recommendations
  top_recommendation TEXT,
  alternative_recommendations TEXT[],
  urgency_level TEXT,

  -- Autonomous actions
  actions_already_taken JSONB,
  actions_pending_approval JSONB,

  -- Executive summary
  summary TEXT,
  key_metrics JSONB,
  risk_assessment TEXT,

  -- Status
  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_by TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT briefing_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT unique_briefing_date UNIQUE (organization_id, briefing_date, briefing_period)
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_org ON prediction_accuracy_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_type ON prediction_accuracy_log(prediction_type);
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_score ON prediction_accuracy_log(accuracy_score);
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy_date ON prediction_accuracy_log(measurement_date DESC);

CREATE INDEX IF NOT EXISTS idx_agent_performance_org ON agent_performance_metrics(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_performance_agent ON agent_performance_metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_performance_date ON agent_performance_metrics(metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_agent_performance_success ON agent_performance_metrics(success_rate DESC);

CREATE INDEX IF NOT EXISTS idx_business_memory_org ON business_memory(organization_id);
CREATE INDEX IF NOT EXISTS idx_business_memory_type ON business_memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_business_memory_confidence ON business_memory(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_business_memory_active ON business_memory(active);

CREATE INDEX IF NOT EXISTS idx_competitive_intel_org ON competitive_intelligence(organization_id);
CREATE INDEX IF NOT EXISTS idx_competitive_intel_importance ON competitive_intelligence(importance);
CREATE INDEX IF NOT EXISTS idx_competitive_intel_status ON competitive_intelligence(status);
CREATE INDEX IF NOT EXISTS idx_competitive_intel_competitor ON competitive_intelligence(competitor_name);

CREATE INDEX IF NOT EXISTS idx_strategy_experiments_org ON strategy_experiments(organization_id);
CREATE INDEX IF NOT EXISTS idx_strategy_experiments_status ON strategy_experiments(decision);
CREATE INDEX IF NOT EXISTS idx_strategy_experiments_type ON strategy_experiments(experiment_type);

CREATE INDEX IF NOT EXISTS idx_learning_recommendations_org ON learning_recommendations(organization_id);
CREATE INDEX IF NOT EXISTS idx_learning_recommendations_status ON learning_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_learning_recommendations_confidence ON learning_recommendations(confidence_score DESC);

CREATE INDEX IF NOT EXISTS idx_system_health_org ON system_health_metrics(organization_id);
CREATE INDEX IF NOT EXISTS idx_system_health_date ON system_health_metrics(metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_system_health_score ON system_health_metrics(overall_health_score);

CREATE INDEX IF NOT EXISTS idx_provider_performance_org ON ai_provider_performance(organization_id);
CREATE INDEX IF NOT EXISTS idx_provider_performance_provider ON ai_provider_performance(provider_name);
CREATE INDEX IF NOT EXISTS idx_provider_performance_cost ON ai_provider_performance(cost_per_outcome);

CREATE INDEX IF NOT EXISTS idx_briefing_org ON executive_intelligence_briefing(organization_id);
CREATE INDEX IF NOT EXISTS idx_briefing_date ON executive_intelligence_briefing(briefing_date DESC);

-- ROW LEVEL SECURITY
ALTER TABLE prediction_accuracy_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY prediction_accuracy_org_isolation ON prediction_accuracy_log
  FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

ALTER TABLE agent_performance_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_performance_org_isolation ON agent_performance_metrics
  FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

ALTER TABLE business_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_memory_org_isolation ON business_memory
  FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

ALTER TABLE competitive_intelligence ENABLE ROW LEVEL SECURITY;
CREATE POLICY competitive_intelligence_org_isolation ON competitive_intelligence
  FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

ALTER TABLE strategy_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategy_experiments_org_isolation ON strategy_experiments
  FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

ALTER TABLE learning_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY learning_recommendations_org_isolation ON learning_recommendations
  FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

ALTER TABLE system_health_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY system_health_org_isolation ON system_health_metrics
  FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

ALTER TABLE ai_provider_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_provider_org_isolation ON ai_provider_performance
  FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

ALTER TABLE executive_intelligence_briefing ENABLE ROW LEVEL SECURITY;
CREATE POLICY executive_briefing_org_isolation ON executive_intelligence_briefing
  FOR ALL USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- GRANTS
GRANT SELECT, INSERT, UPDATE, DELETE ON prediction_accuracy_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_performance_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON business_memory TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON competitive_intelligence TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON strategy_experiments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON learning_recommendations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON system_health_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_provider_performance TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON executive_intelligence_briefing TO authenticated;
