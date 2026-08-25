-- Phase 5: Create Predictive Business Intelligence database schema

-- Stores all forecasts and predictions with confidence scoring and explainability
CREATE TABLE IF NOT EXISTS predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Prediction metadata
  prediction_type TEXT NOT NULL CHECK (prediction_type IN (
    'lead_volume', 'revenue', 'service_demand', 'conversion_rate', 'website_traffic', 
    'seo_ranking', 'customer_acquisition_cost', 'customer_lifetime_value', 'market_size', 
    'competitive_threat', 'seasonal_demand', 'custom'
  )),
  
  -- Timeframe
  timeframe TEXT NOT NULL CHECK (timeframe IN ('7_days', '14_days', '30_days', '90_days', '180_days', 'yearly', 'weekly', 'monthly', 'quarterly')),
  prediction_period_start DATE NOT NULL,
  prediction_period_end DATE NOT NULL,
  
  -- Prediction value and confidence
  predicted_value NUMERIC(12,2) NOT NULL,
  predicted_value_min NUMERIC(12,2),
  predicted_value_max NUMERIC(12,2),
  confidence DECIMAL(5,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  
  -- Supporting data and explainability
  unit TEXT,
  supporting_data JSONB,
  assumptions JSONB,
  model_version TEXT,
  prediction_logic TEXT,
  
  -- Data quality
  data_quality_score DECIMAL(3,2) CHECK (data_quality_score >= 0 AND data_quality_score <= 1),
  data_issues TEXT[],
  
  -- Outcome tracking
  actual_value NUMERIC(12,2),
  actual_measured_at TIMESTAMP WITH TIME ZONE,
  accuracy_score DECIMAL(5,2),
  error_percentage DECIMAL(5,2),
  
  -- Lifecycle
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'superseded', 'invalidated')),
  
  CONSTRAINT predictions_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Historical record of prediction accuracy for model improvement
CREATE TABLE IF NOT EXISTS forecast_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prediction_id uuid NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  
  -- Actual vs predicted
  actual_value NUMERIC(12,2) NOT NULL,
  error_percentage DECIMAL(5,2) NOT NULL,
  accuracy_score DECIMAL(5,2) NOT NULL CHECK (accuracy_score >= 0 AND accuracy_score <= 100),
  
  -- Context
  measurement_date DATE NOT NULL,
  measured_at TIMESTAMP WITH TIME ZONE NOT NULL,
  measurement_method TEXT,
  measurement_source TEXT,
  
  -- Analysis
  notes TEXT,
  contributing_factors JSONB,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT forecast_outcomes_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT forecast_outcomes_pred_fk FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE
);

-- Unified opportunity management system
CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Basic information
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'seo_keyword', 'content_gap', 'website_design', 'conversion_optimization', 
    'competitive_response', 'market_demand', 'service_expansion', 'geographic_expansion',
    'customer_retention', 'cost_reduction', 'automation', 'partnership', 'custom'
  )),
  
  -- Source and traceability
  source_system TEXT NOT NULL,
  source_record_id TEXT,
  
  -- Scoring and prioritization
  opportunity_score DECIMAL(5,2) NOT NULL CHECK (opportunity_score >= 0 AND opportunity_score <= 100),
  impact_estimate_min NUMERIC(12,2),
  impact_estimate_max NUMERIC(12,2),
  impact_type TEXT,
  
  effort_estimate_hours NUMERIC(8,2),
  effort_category TEXT,
  
  roi_estimate DECIMAL(8,2),
  urgency DECIMAL(2,1) CHECK (urgency >= 1 AND urgency <= 5),
  confidence DECIMAL(5,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  
  -- Evidence and reasoning
  evidence JSONB NOT NULL,
  recommended_action TEXT,
  implementation_approach TEXT,
  success_metrics TEXT[],
  
  -- Lifecycle
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'evaluated', 'in_progress', 'completed', 'rejected', 'on_hold')),
  priority_rank INTEGER,
  
  owner_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  assigned_to_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  
  deadline DATE,
  completion_date DATE,
  
  -- Tracking
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT opportunities_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Executive action recommendations with full explainability
CREATE TABLE IF NOT EXISTS recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Recommendation content
  recommendation_title TEXT NOT NULL,
  description TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  
  -- Prioritization
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low', 'monitor')),
  opportunity_score DECIMAL(5,2) CHECK (opportunity_score >= 0 AND opportunity_score <= 100),
  
  -- Impact and effort
  expected_roi DECIMAL(8,2),
  estimated_effort_hours NUMERIC(8,2),
  estimated_cost NUMERIC(10,2),
  
  -- Confidence and evidence
  confidence DECIMAL(5,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  supporting_evidence JSONB,
  alternative_approaches JSONB,
  
  -- Source and explainability
  recommended_by_system TEXT,
  recommendation_basis TEXT,
  related_opportunity_ids uuid[],
  related_prediction_ids uuid[],
  
  -- Approval workflow
  approval_required BOOLEAN DEFAULT FALSE,
  approval_status TEXT DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected', 'expired')),
  approved_by TEXT,
  approval_notes TEXT,
  approval_at TIMESTAMP WITH TIME ZONE,
  
  -- Execution
  execution_status TEXT DEFAULT 'not_started' CHECK (execution_status IN ('not_started', 'in_progress', 'completed', 'rejected', 'deferred')),
  responsible_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  assigned_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  
  deadline DATE,
  completion_date DATE,
  
  -- Measurement
  expected_outcomes TEXT[],
  actual_outcomes TEXT,
  measured BOOLEAN DEFAULT FALSE,
  measurement_date DATE,
  success BOOLEAN,
  learnings TEXT,
  
  -- Lifecycle
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT recommendations_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Track the complete journey: traffic -> lead -> job -> revenue
CREATE TABLE IF NOT EXISTS attribution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Event classification
  event_type TEXT NOT NULL CHECK (event_type IN (
    'impression', 'click', 'visit', 'form_submission', 'lead_created', 
    'qualified_lead', 'job_created', 'job_completed', 'revenue_recorded', 'customer_acquired'
  )),
  event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Channel and source
  channel TEXT NOT NULL CHECK (channel IN (
    'organic_search', 'direct', 'referral', 'paid_search', 'paid_social', 
    'social_organic', 'email', 'gmb', 'display', 'video', 'phone', 'offline', 'other'
  )),
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  
  -- Page and content
  page_url TEXT,
  page_title TEXT,
  service_category TEXT,
  
  -- Location (geographic targeting)
  location TEXT,
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  
  -- User/Session tracking
  visitor_id TEXT,
  session_id TEXT,
  device_type TEXT CHECK (device_type IN ('mobile', 'tablet', 'desktop', 'unknown')),
  user_agent TEXT,
  
  -- Business entities
  lead_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  job_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  
  -- Revenue attribution
  revenue_amount NUMERIC(10,2),
  revenue_source TEXT,
  
  -- Attribution metadata
  attributed_to_channel TEXT,
  attribution_model TEXT,
  attribution_weight DECIMAL(5,2),
  
  -- Qualitative data
  notes TEXT,
  metadata JSONB,
  
  -- Tracking
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT attribution_events_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Periodic snapshots of overall business health
CREATE TABLE IF NOT EXISTS business_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Overall health
  overall_health_score DECIMAL(5,2) NOT NULL CHECK (overall_health_score >= 0 AND overall_health_score <= 100),
  overall_trend TEXT CHECK (overall_trend IN ('improving', 'stable', 'declining', 'volatile')),
  
  -- Component health scores (each 0-100)
  revenue_health DECIMAL(5,2) CHECK (revenue_health >= 0 AND revenue_health <= 100),
  lead_health DECIMAL(5,2) CHECK (lead_health >= 0 AND lead_health <= 100),
  conversion_health DECIMAL(5,2) CHECK (conversion_health >= 0 AND conversion_health <= 100),
  
  seo_health DECIMAL(5,2) CHECK (seo_health >= 0 AND seo_health <= 100),
  website_health DECIMAL(5,2) CHECK (website_health >= 0 AND website_health <= 100),
  content_health DECIMAL(5,2) CHECK (content_health >= 0 AND content_health <= 100),
  
  competitive_health DECIMAL(5,2) CHECK (competitive_health >= 0 AND competitive_health <= 100),
  market_position_health DECIMAL(5,2) CHECK (market_position_health >= 0 AND market_position_health <= 100),
  
  workforce_health DECIMAL(5,2) CHECK (workforce_health >= 0 AND workforce_health <= 100),
  data_quality_score DECIMAL(5,2) CHECK (data_quality_score >= 0 AND data_quality_score <= 100),
  
  -- Detailed breakdown
  components_json JSONB,
  
  -- Context
  snapshot_date DATE NOT NULL,
  snapshot_period TEXT CHECK (snapshot_period IN ('daily', 'weekly', 'monthly')),
  
  -- Summary and alerts
  trend_summary TEXT,
  top_strengths TEXT[],
  top_concerns TEXT[],
  critical_alerts TEXT[],
  
  -- Metadata
  generated_by_system TEXT DEFAULT 'phase5_health_engine',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT business_health_snapshots_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT unique_daily_health_snapshot UNIQUE (organization_id, snapshot_date, snapshot_period)
);

-- Early warning system for risks and threats
CREATE TABLE IF NOT EXISTS predictive_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Alert classification
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'revenue_risk', 'lead_risk', 'seo_risk', 'competitive_threat', 'conversion_risk', 
    'budget_risk', 'data_quality', 'technical', 'market_opportunity', 'custom'
  )),
  
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  
  -- Alert content
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  
  -- Evidence and confidence
  evidence JSONB NOT NULL,
  confidence DECIMAL(5,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  predicted_impact TEXT,
  estimated_impact_revenue NUMERIC(10,2),
  
  -- Recommended response
  recommended_response TEXT,
  urgency_score DECIMAL(5,2),
  
  -- Root cause
  root_cause TEXT,
  contributing_factors JSONB,
  
  -- Timeline
  alert_created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  predicted_impact_date DATE,
  
  -- Response tracking
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'investigating', 'resolved', 'dismissed', 'escalated')),
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  
  resolution_notes TEXT,
  resolved_at TIMESTAMP WITH TIME ZONE,
  
  -- Follow-up
  related_opportunity_ids uuid[],
  related_recommendation_ids uuid[],
  assigned_to_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  assigned_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT predictive_alerts_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Track model versions, performance, and training data
CREATE TABLE IF NOT EXISTS prediction_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Model identification
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  model_type TEXT NOT NULL CHECK (model_type IN ('statistical', 'rule_based', 'ml', 'hybrid', 'manual')),
  
  -- Description and documentation
  description TEXT,
  purpose TEXT,
  prediction_type TEXT,
  
  -- Performance metrics
  accuracy_score DECIMAL(5,2) CHECK (accuracy_score >= 0 AND accuracy_score <= 100),
  mae DECIMAL(8,2),
  rmse DECIMAL(8,2),
  mape DECIMAL(8,2),
  
  -- Training and update info
  training_data_points INTEGER,
  last_trained_at TIMESTAMP WITH TIME ZONE,
  last_updated_at TIMESTAMP WITH TIME ZONE,
  
  -- Availability
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived', 'experimental', 'deprecated')),
  
  -- Model details
  algorithm_description TEXT,
  input_features JSONB,
  hyperparameters JSONB,
  metadata JSONB,
  
  -- Comparison and history
  replaces_model_id uuid REFERENCES prediction_models(id) ON DELETE SET NULL,
  replaced_by_model_id uuid REFERENCES prediction_models(id) ON DELETE SET NULL,
  
  -- Author and ownership
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT prediction_models_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT unique_model_version UNIQUE (organization_id, model_name, model_version)
);

-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_predictions_org ON predictions(organization_id);
CREATE INDEX IF NOT EXISTS idx_predictions_type ON predictions(prediction_type);
CREATE INDEX IF NOT EXISTS idx_predictions_period ON predictions(prediction_period_start, prediction_period_end);
CREATE INDEX IF NOT EXISTS idx_predictions_confidence ON predictions(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);

CREATE INDEX IF NOT EXISTS idx_forecast_outcomes_org ON forecast_outcomes(organization_id);
CREATE INDEX IF NOT EXISTS idx_forecast_outcomes_prediction ON forecast_outcomes(prediction_id);
CREATE INDEX IF NOT EXISTS idx_forecast_outcomes_date ON forecast_outcomes(measured_at DESC);

CREATE INDEX IF NOT EXISTS idx_opportunities_org ON opportunities(organization_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_score ON opportunities(opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_category ON opportunities(category);
CREATE INDEX IF NOT EXISTS idx_opportunities_source ON opportunities(source_system);
CREATE INDEX IF NOT EXISTS idx_opportunities_agent ON opportunities(owner_agent_id);

CREATE INDEX IF NOT EXISTS idx_recommendations_org ON recommendations(organization_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_priority ON recommendations(priority);
CREATE INDEX IF NOT EXISTS idx_recommendations_status ON recommendations(execution_status);
CREATE INDEX IF NOT EXISTS idx_recommendations_confidence ON recommendations(confidence DESC);

CREATE INDEX IF NOT EXISTS idx_attribution_events_org ON attribution_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_attribution_events_type ON attribution_events(event_type);
CREATE INDEX IF NOT EXISTS idx_attribution_events_channel ON attribution_events(channel);
CREATE INDEX IF NOT EXISTS idx_attribution_events_session ON attribution_events(session_id);
CREATE INDEX IF NOT EXISTS idx_attribution_events_timestamp ON attribution_events(event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attribution_events_revenue ON attribution_events(event_type) WHERE revenue_amount IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_health_org ON business_health_snapshots(organization_id);
CREATE INDEX IF NOT EXISTS idx_business_health_date ON business_health_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_business_health_score ON business_health_snapshots(overall_health_score);

CREATE INDEX IF NOT EXISTS idx_predictive_alerts_org ON predictive_alerts(organization_id);
CREATE INDEX IF NOT EXISTS idx_predictive_alerts_severity ON predictive_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_predictive_alerts_status ON predictive_alerts(status);
CREATE INDEX IF NOT EXISTS idx_predictive_alerts_type ON predictive_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_predictive_alerts_created ON predictive_alerts(alert_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prediction_models_org ON prediction_models(organization_id);
CREATE INDEX IF NOT EXISTS idx_prediction_models_status ON prediction_models(status);
CREATE INDEX IF NOT EXISTS idx_prediction_models_name_version ON prediction_models(model_name, model_version);

-- ROW LEVEL SECURITY
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY predictions_org_isolation ON predictions
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE forecast_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY forecast_outcomes_org_isolation ON forecast_outcomes
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY opportunities_org_isolation ON opportunities
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY recommendations_org_isolation ON recommendations
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE attribution_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY attribution_events_org_isolation ON attribution_events
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE business_health_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_health_snapshots_org_isolation ON business_health_snapshots
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE predictive_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY predictive_alerts_org_isolation ON predictive_alerts
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

ALTER TABLE prediction_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY prediction_models_org_isolation ON prediction_models
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- GRANT PERMISSIONS
GRANT SELECT, INSERT, UPDATE, DELETE ON predictions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON forecast_outcomes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON opportunities TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON recommendations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON attribution_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON business_health_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON predictive_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON prediction_models TO authenticated;
