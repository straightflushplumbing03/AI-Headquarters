# AI Headquarters - Phase 2 Implementation Guide

## What's New in Phase 2

### ✅ Completed
- **AI Provider Abstraction**: Multi-provider support (OpenAI ready, Anthropic placeholder)
- **Secure Execution Pipeline**: 15-step authorization and execution flow
- **Cost Tracking**: Real token counting and pricing
- **Logo Uploads**: Supabase Storage integration for company logos
- **Company Goals**: Create and manage organizational objectives
- **AI CEO Agent**: First functional AI employee orchestrating workflows
- **Executive Reporting**: Daily briefings with actual metrics
- **Outcome Tracking**: Learn from task results
- **Comprehensive Testing**: Unit, integration, and E2E test framework

## Architecture Overview

### AI Execution Flow

```
┌─ User/Scheduler creates task
├─ Task routed to AI agent
├─ 15-step security pipeline:
│  1. Authenticate user
│  2. Authorize organization access
│  3. Load organization context
│  4. Load agent configuration
│  5. Load task details
│  6. Check monthly budget
│  7. Verify agent permissions
│  8. Execute AI (OpenAI/Anthropic)
│  9. Validate response quality
│  10. Store execution log
│  11. Update task status
│  12. Log activity for audit
│  13. Extract and store learnings
│  14. Determine next action
│  15. Request approval if needed
├─ Result stored in database
├─ Cost tracked and deducted
└─ Next steps determined (continue or pause)
```

### Database Schema - Phase 2 Tables

#### `ai_provider_config`
Stores AI provider credentials and configuration

#### `ai_execution_logs`
Complete audit trail of every AI execution

#### `ai_usage_limits`
Monthly budget tracking per organization

#### `agent_system_prompts`
Agent instructions and capabilities

#### `company_goals`
Organizational objectives and priorities

#### `approval_requests`
Decisions awaiting human approval

#### `task_outcomes`
Results and learnings from completed tasks

## Implementation Checklist

### Setup
- [ ] Run database migrations: `supabase db push`
- [ ] Configure `.env.local` with API keys
- [ ] Set up Supabase Storage bucket for logos
- [ ] Initialize AI budget for organization

### Testing
- [ ] Run unit tests: `npm run test`
- [ ] Run tests with coverage: `npm run test:coverage`
- [ ] Check TypeScript: `npm run type-check`
- [ ] Lint code: `npm run lint`

### Integration
- [ ] Add AI provider credentials to Supabase
- [ ] Create first AI CEO agent
- [ ] Set up company goals
- [ ] Create test task for AI CEO
- [ ] Monitor execution logs
- [ ] Verify cost tracking

## Usage Examples

### Initialize AI Budget for Organization

```typescript
const costManager = new AICostManager(supabase)
await costManager.initializeBudget(organizationId, 100) // $100/month
```

### Execute AI Task

```typescript
const pipeline = new AIExecutionPipeline(supabase)
const result = await pipeline.execute({
  userId: 'user-123',
  organizationId: 'org-123',
  agentId: 'agent-123',
  taskId: 'task-123',
  systemPrompt: 'You are a helpful assistant',
  userMessage: 'Please analyze this data',
})
```

### Run AI CEO

```typescript
const orchestrator = new AgentOrchestrator(supabase, ceoAgentId, organizationId)
const result = await orchestrator.runCEO(userId, organizationId, ceoAgentId, taskId)
```

### Generate Daily Report

```typescript
const reporter = new ExecutiveReportGenerator(supabase)
const report = await reporter.generateDailyReport(organizationId, userId)
console.log(report.greeting)
console.log(report.summary)
console.log(report.metrics)
```

### Track Task Outcome

```typescript
const tracker = new OutcomeTracker(supabase)
await tracker.recordOutcome(
  organizationId,
  taskId,
  agentId,
  'Analyze competitor',
  'Found 3 new SEO opportunities',
  true,
  ['Competitor has new blog strategy']
)
```

## Safeguards Implemented

### Security
- ✅ Organization isolation via RLS
- ✅ User authentication required
- ✅ Organization membership verification
- ✅ Agent permission checks
- ✅ Budget limits enforced

### Quality
- ✅ Response validation (non-empty)
- ✅ Token counting accuracy
- ✅ Cost tracking for every call
- ✅ Execution logging for audit

### Future Safeguards
- [ ] Infinite loop detection
- [ ] Recursive spawning prevention
- [ ] Prompt injection protection
- [ ] Malicious content detection
- [ ] Publishing approval workflow
- [ ] PAUSE ALL AI emergency kill switch

## Configuration

### AI Provider Selection

Provider detection (in order):
1. If `OPENAI_API_KEY` set → Use OpenAI
2. If `ANTHROPIC_API_KEY` set → Use Anthropic
3. Otherwise → Use PendingProvider (no-op)

No errors when credentials missing - shows "Provider Pending" status.

### Autonomy Levels (1-5)

- **1**: Requires approval for everything
- **2**: Requires approval for external actions
- **3**: Can make decisions within budget
- **4**: Can exceed budget with notification
- **5**: Fully autonomous

## Monitoring

### Key Metrics to Track

- AI execution count per day
- Total cost per organization
- Agent success rates
- Average response time
- Budget utilization percentage
- Failed tasks
- Pending approvals

### Check Execution Status

```typescript
const { data: logs } = await supabase
  .from('ai_execution_logs')
  .select('*')
  .eq('organization_id', organizationId)
  .order('created_at', { ascending: false })
  .limit(10)
```

## Phase 3 Preview

Once Phase 2 is stable:
- Specialized agent templates (SEO, Content, Analytics)
- Background task scheduler
- Multi-agent coordination
- Learning feedback loops
- Performance optimization

## Support

If AI provider returns error:
1. Check `.env.local` for valid API key
2. Verify organization AI budget
3. Check `ai_execution_logs` for error details
4. Review organization RLS policies

## Troubleshooting

### "Provider not configured"
- Add `OPENAI_API_KEY` to `.env.local`
- Restart development server

### "Budget exceeded"
- Increase monthly budget in `ai_usage_limits`
- Or pause AI execution with `pauseAllAI()`

### "Organization not found"
- Verify organization exists in database
- Check user is organization member

### "Agent not authorized"
- Verify agent belongs to organization
- Check agent `active` status
