// Phase 4 Types - Executive Command Center, KPIs, Decisions, Real Business Outcomes

export interface BusinessKPI {
  id: string
  organization_id: string
  kpi_type: 'seo' | 'website' | 'business' | 'custom'
  name: string
  value?: number
  previous_value?: number
  trend?: 'improving' | 'declining' | 'stable'
  unit?: string
  description?: string
  data_source?: string
  last_updated?: string
  created_at: string
}

export interface ExecutiveDecision {
  id: string
  organization_id: string
  decision_title: string
  decision_content: string
  decision_date: string
  made_by?: string
  reason?: string
  evidence?: Record<string, any>
  alternatives_considered?: string[]
  expected_outcome?: string
  confidence?: number
  actions_created?: string[]
  actual_outcome?: string
  outcome_measured: boolean
  outcome_date?: string
  lesson_learned?: string
  created_at: string
}

export interface DailyBriefing {
  id: string
  organization_id: string
  briefing_date: string
  yesterday_summary?: string
  today_summary?: string
  alerts_summary?: string
  ceo_recommendation?: string
  metrics?: Record<string, any>
  generated_at: string
  created_at: string
}

export interface WebsitePage {
  id: string
  organization_id: string
  url: string
  title?: string
  meta_description?: string
  headers?: Record<string, any>
  content_word_count?: number
  internal_links?: number
  external_links?: number
  has_schema?: boolean
  has_canonical?: boolean
  indexable?: boolean
  rank_position?: number
  search_impressions?: number
  search_clicks?: number
  last_analyzed?: string
  issues?: Record<string, any>
  opportunities?: Record<string, any>
  content_gaps?: string[]
  created_at: string
  updated_at: string
}

export interface GitHubChange {
  id: string
  organization_id: string
  request_id: string
  agent_id?: string
  reason: string
  risk_level: 'low' | 'medium' | 'high'
  branch_name: string
  files_changed: string[]
  before_content?: Record<string, any>
  after_content?: Record<string, any>
  diff?: string
  approval_required: boolean
  approval_status?: 'pending' | 'approved' | 'rejected' | 'expired'
  approved_by?: string
  approved_at?: string
  pr_number?: number
  pr_url?: string
  merged: boolean
  merged_at?: string
  deployment_status?: 'pending' | 'deployed' | 'failed' | 'rolled_back'
  deployed_at?: string
  result_measured: boolean
  result?: string
  created_at: string
  updated_at: string
}

export interface SEOExperiment {
  id: string
  organization_id: string
  hypothesis: string
  change_description: string
  page_url?: string
  change_type?: string
  baseline_value?: number
  baseline_metric?: string
  expected_result?: string
  confidence?: number
  started_at?: string
  ended_at?: string
  actual_result?: 'improved' | 'declined' | 'neutral' | 'inconclusive'
  result_value?: number
  change_percent?: number
  significant?: boolean
  learning_recorded?: string
  created_at: string
  updated_at: string
}

export interface CompetitorAlert {
  id: string
  organization_id: string
  competitor_name: string
  alert_type?: string
  finding: string
  opportunity?: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  action_recommended?: string
  workflow_created_id?: string
  status: 'new' | 'reviewed' | 'acted_on' | 'dismissed'
  created_at: string
  updated_at: string
}

export interface AgentPerformance {
  id: string
  organization_id: string
  agent_id: string
  metric_date: string
  tasks_completed: number
  tasks_failed: number
  average_execution_time_seconds?: number
  total_cost: number
  opportunities_discovered: number
  recommendations_accepted: number
  recommendations_rejected: number
  outcomes_generated: number
  accuracy_score?: number
  created_at: string
}

export interface CompanyProfile {
  id: string
  organization_id: string
  company_name: string
  brand_position?: string
  primary_specialties?: string[]
  strategic_market?: string
  service_areas?: string[]
  brand_values?: string[]
  primary_competitors?: string[]
  strategic_objectives?: string[]
  company_context?: string
  additional_info?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface ExecutiveCommandState {
  ai_workforce_status: 'operational' | 'degraded' | 'offline'
  current_strategic_objective?: string
  active_workflows_count: number
  tasks_waiting_approval: number
  recent_decisions: ExecutiveDecision[]
  top_opportunities: Array<any>
  agent_activity: Array<any>
  business_kpis: BusinessKPI[]
  ai_operating_cost: number
  budget_remaining: number
  competitive_threats: CompetitorAlert[]
  health_warnings: string[]
}
