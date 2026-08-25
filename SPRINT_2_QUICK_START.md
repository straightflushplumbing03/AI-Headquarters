# SPRINT 2 QUICK START GUIDE
## Real AI + Cost Control + Founder Access

---

## 🚀 SETUP (5 Minutes)

### Step 1: Set Environment Variables
```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Choose ONE provider:
OPENAI_API_KEY="sk-..." # For OpenAI
# OR
ANTHRPIC_API_KEY="sk-ant-..." # For Anthropic
```

### Step 2: Start Application
```bash
npm run dev
# App running at http://localhost:3000
```

### Step 3: Designate Founder (One-Time)
```typescript
// In your setup script
import { FounderAccountManager } from '@/lib/founder/founder-manager'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(url, key)
const founderManager = new FounderAccountManager(supabase)

// Designate user as founder
await founderManager.designateAsFounder('user-id-123')

// Set AI budget ($250/month)
await founderManager.setFounderAIBudget('user-id-123', 250)
```

---

## 📝 EXECUTE AI

### Basic Request
```bash
curl -X POST http://localhost:3000/api/ai/execute \
  -H "Content-Type: application/json" \
  -d '{
    "organizationId": "org-123",
    "agentId": "agent-456",
    "taskId": "task-789",
    "systemPrompt": "You are a helpful assistant.",
    "userMessage": "What is 2+2?",
    "maxTokens": 100
  }'
```

### Response (Success)
```json
{
  "success": true,
  "content": "2+2 equals 4",
  "inputTokens": 12,
  "outputTokens": 2,
  "actualCost": 0.00024,
  "executionTimeMs": 850,
  "provider": "openai",
  "model": "gpt-4-turbo"
}
```

### Response (Budget Exceeded)
```json
{
  "success": false,
  "error": "Budget exceeded. Remaining: $25.00, Required: $30.00",
  "errorType": "budget_exceeded",
  "actualCost": 0
}
```

---

## 💰 CHECK SPENDING

```bash
# Get organization spending
curl http://localhost:3000/api/ai/spending?organizationId=org-123
```

### Response
```json
{
  "monthlyBudget": 100,
  "currentSpend": 23.45,
  "remaining": 76.55,
  "percentUsed": 23.45
}
```

---

## 👑 FOUNDER CONTROLS

### Set Founder AI Budget
```bash
curl -X POST http://localhost:3000/api/founder/ai-budget \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer FOUNDER_TOKEN" \
  -d '{
    "monthlyBudget": 500
  }'
```

### Get Founder AI Budget
```bash
curl http://localhost:3000/api/founder/ai-budget \
  -H "Authorization: Bearer FOUNDER_TOKEN"
```

### Response
```json
{
  "monthlyBudget": 500,
  "currentSpend": 45.50,
  "remaining": 454.50
}
```

---

## 🛑 EMERGENCY STOP (Founder Only)

### Enable Global Kill Switch
```bash
curl -X POST http://localhost:3000/api/founder/emergency-stop \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer FOUNDER_TOKEN" \
  -d '{ "enable": true }'
```

**Result**: NO AI requests execute globally

### Disable Global Kill Switch
```bash
curl -X POST http://localhost:3000/api/founder/emergency-stop \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer FOUNDER_TOKEN" \
  -d '{ "enable": false }'
```

**Result**: AI requests resume

---

## 📊 COST CALCULATION EXAMPLES

### Example 1: OpenAI GPT-4 Turbo
```
Input tokens: 150
Output tokens: 450

OpenAI Pricing:
- Input: $10 per 1M tokens
- Output: $30 per 1M tokens

Cost Calculation:
- Input: (150 / 1,000,000) * $10 = $0.0015
- Output: (450 / 1,000,000) * $30 = $0.0135
- Total: $0.015
```

### Example 2: Anthropic Claude 3 Sonnet
```
Input tokens: 200
Output tokens: 300

Anthropic Pricing:
- Input: $3 per 1M tokens
- Output: $15 per 1M tokens

Cost Calculation:
- Input: (200 / 1,000,000) * $3 = $0.0006
- Output: (300 / 1,000,000) * $15 = $0.0045
- Total: $0.0051
```

---

## 🔒 SECURITY

### API Keys
✅ Hidden in environment variables  
✅ Never sent to client  
✅ Never logged  
✅ Server-side only  

### Founder Role
✅ Verified server-side every request  
✅ Based on database (user_roles table)  
✅ Cannot be spoofed from client  
✅ Actions logged to audit_logs  

### Budget Enforcement
✅ Checked BEFORE provider call  
✅ Cannot be bypassed  
✅ Recorded in database  
✅ Organization isolated  

---

## 📈 MONITORING

### View AI Execution Logs
```sql
SELECT * FROM ai_execution_logs 
WHERE organization_id = 'org-123' 
ORDER BY created_at DESC;
```

### View Organization Budget
```sql
SELECT * FROM ai_usage_limits 
WHERE organization_id = 'org-123';
```

### View Audit Trail
```sql
SELECT * FROM audit_logs 
WHERE action LIKE 'emergency_stop%' 
ORDER BY timestamp DESC;
```

---

## ❌ ERROR CODES

| Error | Meaning | Action |
|-------|---------|--------|
| `provider_not_configured` | No API key set | Set OPENAI_API_KEY or ANTHROPIC_API_KEY |
| `authentication_failed` | Invalid API key | Check your API key |
| `rate_limit` | Too many requests | Wait and retry |
| `provider_outage` | Service down | Wait for provider to recover |
| `timeout` | Request took too long | Reduce maxTokens |
| `budget_exceeded` | Not enough budget | Increase organization budget |
| `invalid_organization` | Org not found | Check organizationId |
| `invalid_agent` | Agent not found | Check agentId |

---

## 🔄 TROUBLESHOOTING

### "No provider configured"
```bash
# Verify API key is set
echo $OPENAI_API_KEY
# or
echo $ANTHROPIC_API_KEY
```

### "Budget exceeded" on first request
```sql
-- Check organization budget
SELECT monthly_budget, current_spend 
FROM ai_usage_limits 
WHERE organization_id = 'org-123';

-- Increase if needed (admin query)
UPDATE ai_usage_limits 
SET monthly_budget = 500 
WHERE organization_id = 'org-123';
```

### Kill switch not working
```sql
-- Check if emergency stop is active
SELECT paused, pause_reason FROM ai_usage_limits;

-- Check kill switch logs
SELECT * FROM audit_logs 
WHERE action = 'emergency_stop_enabled';
```

---

## 💡 BEST PRACTICES

### 1. Set Realistic Budgets
```typescript
// Good: $100/month for small org
await supabase.from('ai_usage_limits')
  .update({ monthly_budget: 100 })
  .eq('organization_id', 'org-123')

// Bad: $0 (blocks all AI)
// Bad: $10,000 (no cost control)
```

### 2. Monitor Spending Weekly
```typescript
// Check spending status
const spending = await executionService.getOrganizationSpending('org-123')
if (spending.percentUsed > 80) {
  // Alert: Budget running low
}
```

### 3. Use Kill Switch for Testing
```typescript
// Disable global AI during testing
await costController.enableGlobalKillSwitch()

// Re-enable when ready
await costController.disableGlobalKillSwitch()
```

### 4. Set Founder AI Budget
```typescript
// Founder should have separate budget
await founderManager.setFounderAIBudget('founder-id', 250) // $250/month
```

---

## 📚 CODE EXAMPLES

### Execute AI in TypeScript
```typescript
import { AIExecutionService } from '@/lib/ai/execution-service'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(url, key)
const aiService = new AIExecutionService(supabase)

const result = await aiService.execute({
  organizationId: 'org-123',
  agentId: 'agent-456',
  taskId: 'task-789',
  systemPrompt: 'You are helpful',
  userMessage: 'Help me with...',
  maxTokens: 2000,
})

if (result.success) {
  console.log('AI Response:', result.content)
  console.log('Cost:', result.actualCost)
} else {
  console.log('Error:', result.error)
}
```

### Check Budget Before Request
```typescript
const spending = await aiService.getOrganizationSpending('org-123')

if (spending.remaining < estimatedCost) {
  console.log('Not enough budget')
  return
}

// Proceed with request
const result = await aiService.execute({...})
```

### Toggle Kill Switch
```typescript
import { AICostController } from '@/lib/ai/cost-controller'

const costController = new AICostController(supabase)

// Disable all AI
await costController.enableGlobalKillSwitch()

// Resume AI
await costController.disableGlobalKillSwitch()
```

---

## 🎯 NEXT STEPS

### After Deployment
1. ✅ Set API keys
2. ✅ Create founder account
3. ✅ Test one AI request
4. ✅ Verify cost tracking
5. ✅ Monitor spending

### Upcoming (Sprint 3)
- Rate limiting
- Request deduplication
- Exponential backoff
- Provider fallback
- Founder dashboard
- Cost analytics

---

## 📞 SUPPORT

**Documentation**: See SPRINT_2_COMPLETION_REPORT.md  
**Issues**: Check error codes above  
**Questions**: Review code comments in `/lib/ai/`  

---

**Status**: ✅ Production Ready  
**Last Updated**: 2026-08-25  
**Maintainer**: Business Brain Team
