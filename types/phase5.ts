/**
 * Phase 5: Predictive Business Intelligence Types
 * TypeScript definitions for predictive system
 */

export namespace Phase5 {
  // ============================================================================
  // PREDICTIONS
  // ============================================================================

  export type PredictionType =
    | 'lead_volume'
    | 'revenue'
    | 'service_demand'
    | 'conversion_rate'
    | 'website_traffic'
    | 'seo_ranking'
    | 'customer_acquisition_cost'
    | 'customer_lifetime_value'
    | 'market_size'
    | 'competitive_threat'
    | 'seasonal_demand'
    | 'custom';

  export type Timeframe =
    | '7_days'
    | '14_days'
    | '30_days'
    | '90_days'
    | '180_days'
    | 'yearly'
    | 'weekly'
    | 'monthly'
    | 'quarterly';

  export type PredictionStatus = 'active' | 'expired' | 'superseded' | 'invalidated';

  export interface Prediction {
    id: string;
    organization_id: string;

    // Prediction metadata
    prediction_type: PredictionType;

    // Timeframe
    timeframe: Timeframe;
    prediction_period_start: string; // DATE
    prediction_period_end: string; // DATE

    // Prediction value and confidence
    predicted_value: number;
    predicted_value_min?: number;
    predicted_value_max?: number;
    confidence: number; // 0-100

    // Supporting data
    unit?: string;
    supporting_data?: Record<string, any>;
    assumptions?: Record<string, any>;
    model_version?: string;
    prediction_logic?: string;

    // Data quality
    data_quality_score?: number; // 0-1
    data_issues?: string[];

    // Outcome tracking
    actual_value?: number;
    actual_measured_at?: string; // TIMESTAMP
    accuracy_score?: number; // 0-100
    error_percentage?: number;

    // Lifecycle
    created_at: string;
    expires_at?: string;
    status: PredictionStatus;
  }

  export interface ForecastOutcome {
    id: string;
    organization_id: string;
    prediction_id: string;

    // Actual vs predicted
    actual_value: number;
    error_percentage: number;
    accuracy_score: number; // 0-100

    // Context
    measurement_date: string; // DATE
    measured_at: string; // TIMESTAMP
    measurement_method?: string;
    measurement_source?: string;

    // Analysis
    notes?: string;
    contributing_factors?: Record<string, any>;

    created_at: string;
  }

  // ============================================================================
  // OPPORTUNITIES
  // ============================================================================

  export type OpportunityCategory =
    | 'seo_keyword'
    | 'content_gap'
    | 'website_design'
    | 'conversion_optimization'
    | 'competitive_response'
    | 'market_demand'
    | 'service_expansion'
    | 'geographic_expansion'
    | 'customer_retention'
    | 'cost_reduction'
    | 'automation'
    | 'partnership'
    | 'custom';

  export type SourceSystem =
    | 'seo_intelligence'
    | 'website_intelligence'
    | 'competitive_watch'
    | 'market_analysis'
    | 'custom';

  export type OpportunityStatus = 'new' | 'evaluated' | 'in_progress' | 'completed' | 'rejected' | 'on_hold';
  export type EffortCategory = 'quick_win' | 'medium' | 'major_project';
  export type ImpactType = 'revenue' | 'cost_savings' | 'lead_generation' | 'traffic' | 'conversion' | 'retention';

  export interface Opportunity {
    id: string;
    organization_id: string;

    // Basic information
    title: string;
    description: string;
    category: OpportunityCategory;

    // Source and traceability
    source_system: SourceSystem;
    source_record_id?: string;

    // Scoring
    opportunity_score: number; // 0-100
    impact_estimate_min?: number;
    impact_estimate_max?: number;
    impact_type?: ImpactType;

    effort_estimate_hours?: number;
    effort_category?: EffortCategory;

    roi_estimate?: number;
    urgency: number; // 1-5
    confidence: number; // 0-100

    // Evidence
    evidence: Record<string, any>;
    recommended_action?: string;
    implementation_approach?: string;
    success_metrics?: string[];

    // Lifecycle
    status: OpportunityStatus;
    priority_rank?: number;

    owner_agent_id?: string;
    assigned_to_task_id?: string;

    deadline?: string; // DATE
    completion_date?: string; // DATE

    // Tracking
    discovered_at: string;
    created_at: string;
    updated_at: string;
  }

  // ============================================================================
  // RECOMMENDATIONS
  // ============================================================================

  export type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low' | 'monitor';
  export type RecommendationBasis = 'prediction' | 'opportunity' | 'threat' | 'pattern' | 'manual';
  export type RecommendationApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
  export type RecommendationExecutionStatus = 'not_started' | 'in_progress' | 'completed' | 'rejected' | 'deferred';

  export interface Recommendation {
    id: string;
    organization_id: string;

    // Content
    recommendation_title: string;
    description: string;
    reasoning: string;

    // Prioritization
    priority: RecommendationPriority;
    opportunity_score?: number; // 0-100

    // Impact and effort
    expected_roi?: number;
    estimated_effort_hours?: number;
    estimated_cost?: number;

    // Confidence
    confidence: number; // 0-100
    supporting_evidence?: Record<string, any>;
    alternative_approaches?: Record<string, any>;

    // Source
    recommended_by_system?: string;
    recommendation_basis?: RecommendationBasis;
    related_opportunity_ids?: string[];
    related_prediction_ids?: string[];

    // Approval
    approval_required: boolean;
    approval_status: RecommendationApprovalStatus;
    approved_by?: string;
    approval_notes?: string;
    approval_at?: string;

    // Execution
    execution_status: RecommendationExecutionStatus;
    responsible_agent_id?: string;
    assigned_task_id?: string;

    deadline?: string;
    completion_date?: string;

    // Measurement
    expected_outcomes?: string[];
    actual_outcomes?: string;
    measured: boolean;
    measurement_date?: string;
    success?: boolean;
    learnings?: string;

    // Lifecycle
    created_at: string;
    updated_at: string;
    expires_at?: string;
  }

  // ============================================================================
  // ATTRIBUTION
  // ============================================================================

  export type AttributionEventType =
    | 'impression'
    | 'click'
    | 'visit'
    | 'form_submission'
    | 'lead_created'
    | 'qualified_lead'
    | 'job_created'
    | 'job_completed'
    | 'revenue_recorded'
    | 'customer_acquired';

  export type Channel =
    | 'organic_search'
    | 'direct'
    | 'referral'
    | 'paid_search'
    | 'paid_social'
    | 'social_organic'
    | 'email'
    | 'gmb'
    | 'display'
    | 'video'
    | 'phone'
    | 'offline'
    | 'other';

  export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';
  export type AttributionModel = 'first_touch' | 'last_touch' | 'linear' | 'time_decay' | 'custom';

  export interface AttributionEvent {
    id: string;
    organization_id: string;

    // Event
    event_type: AttributionEventType;
    event_timestamp: string; // TIMESTAMP

    // Channel
    channel: Channel;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;

    // Page
    page_url?: string;
    page_title?: string;
    service_category?: string;

    // Location
    location?: string;
    latitude?: number;
    longitude?: number;

    // User/Session
    visitor_id?: string;
    session_id?: string;
    device_type?: DeviceType;
    user_agent?: string;

    // Business entities
    lead_id?: string;
    job_id?: string;

    // Revenue
    revenue_amount?: number;
    revenue_source?: string;

    // Attribution
    attributed_to_channel?: string;
    attribution_model?: AttributionModel;
    attribution_weight?: number; // 0-1

    // Metadata
    notes?: string;
    metadata?: Record<string, any>;

    created_at: string;
  }

  // ============================================================================
  // BUSINESS HEALTH
  // ============================================================================

  export type HealthTrend = 'improving' | 'stable' | 'declining' | 'volatile';
  export type SnapshotPeriod = 'daily' | 'weekly' | 'monthly';

  export interface BusinessHealthSnapshot {
    id: string;
    organization_id: string;

    // Overall
    overall_health_score: number; // 0-100
    overall_trend?: HealthTrend;

    // Component scores
    revenue_health?: number;
    lead_health?: number;
    conversion_health?: number;

    seo_health?: number;
    website_health?: number;
    content_health?: number;

    competitive_health?: number;
    market_position_health?: number;

    workforce_health?: number;
    data_quality_score?: number;

    // Breakdown
    components_json?: Record<string, any>;

    // Context
    snapshot_date: string; // DATE
    snapshot_period: SnapshotPeriod;

    // Summary
    trend_summary?: string;
    top_strengths?: string[];
    top_concerns?: string[];
    critical_alerts?: string[];

    // Metadata
    generated_by_system: boolean;
    created_at: string;
  }

  // ============================================================================
  // PREDICTIVE ALERTS
  // ============================================================================

  export type AlertType =
    | 'revenue_risk'
    | 'lead_risk'
    | 'seo_risk'
    | 'competitive_threat'
    | 'conversion_risk'
    | 'budget_risk'
    | 'data_quality'
    | 'technical'
    | 'market_opportunity'
    | 'custom';

  export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
  export type AlertStatus = 'new' | 'acknowledged' | 'investigating' | 'resolved' | 'dismissed' | 'escalated';

  export interface PredictiveAlert {
    id: string;
    organization_id: string;

    // Classification
    alert_type: AlertType;
    severity: AlertSeverity;

    // Content
    title: string;
    description: string;

    // Evidence
    evidence: Record<string, any>;
    confidence: number; // 0-100
    predicted_impact?: string;
    estimated_impact_revenue?: number;

    // Response
    recommended_response?: string;
    urgency_score?: number; // 0-100

    // Root cause
    root_cause?: string;
    contributing_factors?: Record<string, any>;

    // Timeline
    alert_created_at: string;
    predicted_impact_date?: string;

    // Status
    status: AlertStatus;
    acknowledged_by?: string;
    acknowledged_at?: string;

    resolution_notes?: string;
    resolved_at?: string;

    // Follow-up
    related_opportunity_ids?: string[];
    related_recommendation_ids?: string[];
    assigned_to_agent_id?: string;
    assigned_task_id?: string;

    created_at: string;
  }

  // ============================================================================
  // PREDICTION MODELS
  // ============================================================================

  export type ModelType = 'statistical' | 'rule_based' | 'ml' | 'hybrid' | 'manual';
  export type ModelStatus = 'active' | 'inactive' | 'archived' | 'experimental' | 'deprecated';

  export interface PredictionModel {
    id: string;
    organization_id: string;

    // Identification
    model_name: string;
    model_version: string;
    model_type: ModelType;

    // Documentation
    description?: string;
    purpose?: string;
    prediction_type?: PredictionType;

    // Performance
    accuracy_score?: number; // 0-100
    mae?: number;
    rmse?: number;
    mape?: number;

    // Training
    training_data_points?: number;
    last_trained_at?: string;
    last_updated_at?: string;

    // Status
    status: ModelStatus;

    // Details
    algorithm_description?: string;
    input_features?: Record<string, any>;
    hyperparameters?: Record<string, any>;
    metadata?: Record<string, any>;

    // History
    replaces_model_id?: string;
    replaced_by_model_id?: string;

    // Author
    created_by?: string;
    created_at: string;
  }

  // ============================================================================
  // EXECUTIVE INTERFACES
  // ============================================================================

  export interface PredictiveIntelligenceState {
    // Current predictions
    predictions: {
      lead_forecast_7days?: Prediction;
      revenue_forecast_30days?: Prediction;
      demand_forecast?: Prediction;
    };

    // Top opportunities
    topOpportunities: Opportunity[];
    opportunitiesByCategory: Record<OpportunityCategory, Opportunity[]>;

    // Executive recommendations
    topRecommendations: Recommendation[];
    urgentRecommendations: Recommendation[];
    approvalPendingRecommendations: Recommendation[];

    // Business health
    businessHealth: BusinessHealthSnapshot;
    healthTrends: BusinessHealthSnapshot[];

    // Alerts
    activeAlerts: PredictiveAlert[];
    criticalAlerts: PredictiveAlert[];
    acknowledgedAlerts: PredictiveAlert[];

    // Attribution
    attributionSummary: {
      top_channels: { channel: Channel; revenue: number }[];
      conversion_paths: string[][];
      revenue_by_channel: Record<Channel, number>;
    };

    // Model performance
    modelAccuracy: Record<string, number>;
    lastUpdated: string;
  }

  export interface PredictionConfidence {
    prediction: number;
    min: number;
    max: number;
    confidence: number; // 0-100
    data_quality: number; // 0-1
    data_issues: string[];
    explanation: string;
  }

  export interface OpportunityScoringBreakdown {
    title: string;
    impact: number;
    effort: number;
    urgency: number;
    confidence: number;
    feasibility: number;
    roi: number;
    overall_score: number;
    reasoning: string;
    priority_rank: number;
  }

  export interface RecommendationSummary {
    recommendation: string;
    priority: RecommendationPriority;
    why: string; // Explanation
    why_now: string; // Timing rationale
    expected_benefit: string;
    effort: string;
    confidence: number;
    roi: number;
  }
}
