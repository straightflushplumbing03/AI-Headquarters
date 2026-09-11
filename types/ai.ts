export interface AIProviderConfig {
  provider: 'openai' | 'anthropic' | 'pending'
  model: string
  apiKey?: string
  isConfigured: boolean
  status: 'active' | 'pending' | 'error'
}

export interface AIExecutionRequest {
  organizationId: string
  agentId: string
  taskId: string
  systemPrompt: string
  userMessage: string
  maxTokens?: number
  temperature?: number
}

export interface AIExecutionResult {
  success: boolean
  content: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  actualCost: number
  executionTimeMs: number
  provider?: 'openai' | 'anthropic'
  model?: string
  error?: string
  errorType?: string
}

export interface AICostTracking {
  id: string
  organizationId: string
  agentId: string
  taskId: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number
  actualCost: number
  executionTimeMs: number
  status: 'success' | 'failed'
  errorType?: string
  createdAt: string
}

export interface AIUsageLimit {
  organizationId: string
  monthlyBudget: number
  currentSpend: number
  resetDate: string
  paused: boolean
  pauseReason?: string
}

export interface AgentSystemPrompt {
  id: string
  organizationId: string
  agentId: string
  role: string
  purpose: string
  constraints: string[]
  capabilities: string[]
  systemPrompt: string
  createdAt: string
  updatedAt: string
}

export interface CompanyGoal {
  id: string
  organizationId: string
  title: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  targetDate?: string
  status: 'active' | 'completed' | 'paused'
  createdAt: string
  updatedAt: string
}

export interface ApprovalRequest {
  id: string
  organizationId: string
  taskId: string
  agentId: string
  type: 'task_execution' | 'knowledge_storage' | 'external_action' | 'budget_exception'
  title: string
  description: string
  proposedAction: string
  metadata?: Record<string, any>
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  createdAt: string
  expiresAt: string
  respondedAt?: string
}

export interface TaskOutcome {
  id: string
  organizationId: string
  taskId: string
  agentId: string
  objective: string
  result: string
  success: boolean
  learnings: string[]
  metrics?: Record<string, number>
  createdAt: string
}
