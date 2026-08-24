// Phase 3 Types - Agent Registry, Capabilities, Workflows, Knowledge

export interface AgentRegistry {
  id: string
  organization_id: string
  name: string
  title: string
  description: string
  role: string
  type: 'ceo' | 'research' | 'strategist' | 'implementer' | 'analyst' | 'learning'
  system_prompt: string
  version: number
  status: 'active' | 'inactive' | 'archived'
  capabilities: string[]
  autonomy_level: number // 1-5
  approval_required: boolean
  monthly_budget_limit?: number
  task_budget_limit?: number
  max_concurrent_tasks: number
  retry_attempts: number
  performance_metrics?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface AgentCapability {
  id: string
  organization_id: string
  agent_id: string
  capability_name: string
  capability_type: 'read' | 'write' | 'execute' | 'approve' | 'delegate'
  resource_type: string
  requires_approval: boolean
  conditions?: Record<string, any>
  created_at: string
}

export interface TaskWorkflow {
  id: string
  organization_id: string
  name: string
  description: string
  steps: WorkflowStep[]
  created_by?: string
  status: 'active' | 'archived' | 'draft'
  created_at: string
  updated_at: string
}

export interface WorkflowStep {
  id: string
  agent_id: string
  action: string
  inputs?: Record<string, any>
  outputs?: Record<string, any>
  requires_approval?: boolean
  depends_on?: string[] // step ids
  timeout_minutes?: number
  retry_policy?: RetryPolicy
}

export interface RetryPolicy {
  max_attempts: number
  backoff_type: 'linear' | 'exponential'
  initial_delay_seconds: number
}

export interface Opportunity {
  id: string
  organization_id: string
  title: string
  description: string
  category: string
  source?: string
  potential_impact?: number
  confidence_score: number // 0-1
  effort_estimate?: number // hours
  priority_score: number
  status: 'identified' | 'evaluated' | 'planned' | 'in_progress' | 'completed' | 'rejected'
  discovered_by?: string
  recommended_action?: string
  evidence?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface CompetitiveIntelligence {
  id: string
  organization_id: string
  competitor_name: string
  finding_type: string
  finding: string
  source?: string
  category: string
  importance: 'low' | 'medium' | 'high' | 'critical'
  opportunity?: string
  recommended_action?: string
  confidence: number // 0-1
  discovered_by?: string
  previous_value?: string
  is_change: boolean
  created_at: string
  updated_at: string
}

export interface SEOOpportunity {
  id: string
  organization_id: string
  keyword: string
  location?: string
  search_volume?: number
  difficulty?: number // 0-1
  current_ranking?: number
  opportunity_type: 'keyword' | 'content_gap' | 'topic_cluster' | 'technical' | 'local' | 'schema' | 'link' | 'page_improvement'
  estimated_traffic?: number
  estimated_revenue_impact?: number
  recommendation: string
  priority_score: number
  status: 'identified' | 'in_progress' | 'implemented' | 'rejected'
  discovered_by?: string
  created_at: string
}

export interface OrganizationalKnowledge {
  id: string
  organization_id: string
  knowledge_type: 'finding' | 'strategy' | 'learning' | 'outcome' | 'best_practice' | 'warning'
  category: string
  title: string
  content: string
  source?: string
  source_task_id?: string
  confidence?: number // 0-1
  created_by?: string
  tags?: string[]
  embeddings_pending: boolean
  created_at: string
  updated_at: string
}

export interface WorkflowExecution {
  id: string
  organization_id: string
  workflow_id: string
  initiated_by?: string
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  current_step: number
  total_steps: number
  execution_context?: Record<string, any>
  error_log: string[]
  total_cost: number
  started_at: string
  completed_at?: string
  updated_at: string
}

export interface ScheduledJob {
  id: string
  organization_id: string
  agent_id: string
  job_type: string
  frequency: 'daily' | 'weekly' | 'monthly' | 'on_demand'
  schedule_cron?: string
  next_run_at?: string
  last_run_at?: string
  status: 'active' | 'paused' | 'archived'
  max_duration_minutes: number
  task_template?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface ExternalConnector {
  id: string
  organization_id: string
  connector_type: string
  name: string
  provider: string
  credentials_encrypted?: string
  permissions: string[]
  status: 'pending' | 'active' | 'error' | 'paused'
  last_sync?: string
  error_message?: string
  usage_stats?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface PriorityScore {
  impact: number // 0-1
  confidence: number // 0-1
  urgency: number // 0-1
  effort: number // 0-1 (lower is better)
  calculated_score: number // impact * confidence * urgency / effort
}
