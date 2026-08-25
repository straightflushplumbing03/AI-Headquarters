# SPRINT 2 DEPLOYMENT CHECKLIST
## Real AI Providers + Cost Control + Founder Access

---

## PRE-DEPLOYMENT (Do Before Going Live)

### Database Setup
- [ ] Create `founder_accounts` table
  ```sql
  CREATE TABLE founder_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id),
    email VARCHAR NOT NULL,
    ai_daily_budget DECIMAL(10,2) DEFAULT 10,
    ai_monthly_budget DECIMAL(10,2) DEFAULT 250,
    created_at TIMESTAMP DEFAULT NOW()
  );
  ```

- [ ] Create `audit_logs` table
  ```sql
  CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    action VARCHAR NOT NULL,
    resource VARCHAR,
    timestamp TIMESTAMP DEFAULT NOW(),
    details JSONB
  );
  ```

- [ ] Create `ai_execution_logs` table
  ```sql
  CREATE TABLE ai_execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    agent_id UUID NOT NULL REFERENCES agents(id),
    task_id VARCHAR NOT NULL,
    provider VARCHAR NOT NULL,
    model VARCHAR NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    estimated_cost DECIMAL(10,4) DEFAULT 0,
    actual_cost DECIMAL(10,4) DEFAULT 0,
    execution_time_ms INTEGER DEFAULT 0,
    status VARCHAR DEFAULT 'success',
    error_type VARCHAR,
    created_at TIMESTAMP DEFAULT NOW()
  );
  ```

- [ ] Create `ai_usage_limits` table (if not exists)
  ```sql
  CREATE TABLE ai_usage_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL UNIQUE REFERENCES organizations(id),
    monthly_budget DECIMAL(10,2) DEFAULT 100,
    current_spend DECIMAL(10,4) DEFAULT 0,
    paused BOOLEAN DEFAULT FALSE,
    pause_reason VARCHAR,
    reset_date DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
  ```

- [ ] Update `user_roles` table (add 'founder' role)
  ```sql
  -- Add if not exists
  ALTER TABLE user_roles ADD CONSTRAINT check_valid_role 
    CHECK (role IN ('founder', 'owner', 'admin', 'member', 'viewer'));
  ```

- [ ] Create indices for performance
  ```sql
  CREATE INDEX idx_ai_execution_logs_org ON ai_execution_logs(organization_id);
  CREATE INDEX idx_ai_execution_logs_agent ON ai_execution_logs(agent_id);
  CREATE INDEX idx_ai_execution_logs_created ON ai_execution_logs(created_at);
  CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
  CREATE INDEX idx_audit_logs_action ON audit_logs(action);
  ```

### Environment Variables
- [ ] Set `OPENAI_API_KEY` OR `ANTHROPIC_API_KEY`
  ```bash
  # .env.local (development)
  OPENAI_API_KEY="sk-..."
  
  # OR
  ANTHROPIC_API_KEY="sk-ant-..."
  ```

- [ ] Verify `SUPABASE_SERVICE_ROLE_KEY` is set (server-side only)
  ```bash
  # .env.local
  SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
  ```

- [ ] Verify `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set
  ```bash
  # .env.local
  NEXT_PUBLIC_SUPABASE_URL="https://..."
  NEXT_PUBLIC_SUPABASE_ANON_KEY="..."
  ```

### Code Verification
- [ ] Verify `lib/ai/providers.ts` contains real provider implementations
- [ ] Verify `lib/ai/cost-controller.ts` has budget enforcement
- [ ] Verify `lib/founder/permissions.ts` has server-side verification
- [ ] Verify API routes exist:
  - [ ] `app/api/ai/execute/route.ts`
  - [ ] `app/api/ai/spending/route.ts`
  - [ ] `app/api/founder/ai-budget/route.ts`
  - [ ] `app/api/founder/emergency-stop/route.ts`

### Security Verification
- [ ] Confirm API keys are NOT in version control
- [ ] Confirm API keys are in `.env.local` or secrets manager (NOT .env.local in git)
- [ ] Confirm RLS policies are enabled on all AI tables
- [ ] Confirm service role key is only used server-side
- [ ] Confirm client-side code cannot see API keys

---

## TESTING (Before Going Live)

### Manual Tests
- [ ] Test 1: Make one real AI request
  ```bash
  curl -X POST http://localhost:3000/api/ai/execute \
    -H "Content-Type: application/json" \
    -d '{
      "organizationId": "org-123",
      "agentId": "agent-456",
      "taskId": "test-001",
      "systemPrompt": "You are helpful.",
      "userMessage": "What is 2+2?"
    }'
  ```
  - [ ] Response is JSON
  - [ ] `success: true`
  - [ ] `content` is not empty
  - [ ] `actualCost` > 0
  - [ ] `inputTokens` > 0
  - [ ] `outputTokens` > 0

- [ ] Test 2: Verify cost was recorded
  ```sql
  SELECT * FROM ai_execution_logs 
  WHERE task_id = 'test-001';
  ```
  - [ ] Record exists
  - [ ] `actual_cost` matches API response
  - [ ] `input_tokens` matches API response
  - [ ] `output_tokens` matches API response

- [ ] Test 3: Verify organization spending updated
  ```sql
  SELECT current_spend FROM ai_usage_limits 
  WHERE organization_id = 'org-123';
  ```
  - [ ] `current_spend` increased by the cost

- [ ] Test 4: Test budget enforcement
  ```sql
  UPDATE ai_usage_limits 
  SET monthly_budget = 0.001, current_spend = 0 
  WHERE organization_id = 'org-123';
  ```
  - [ ] Make AI request → Should fail with "Budget exceeded"
  - [ ] No charge in `ai_execution_logs`
  - [ ] Restore budget
  ```sql
  UPDATE ai_usage_limits 
  SET monthly_budget = 100 
  WHERE organization_id = 'org-123';
  ```

- [ ] Test 5: Test kill switch
  ```bash
  # Enable kill switch
  curl -X POST http://localhost:3000/api/founder/emergency-stop \
    -H "Authorization: Bearer FOUNDER_TOKEN" \
    -d '{ "enable": true }'
  ```
  - [ ] Response: "Global AI emergency stop ENABLED"
  - [ ] Try AI request → Should fail
  - [ ] Error message: "Global kill switch enabled"
  - [ ] Disable kill switch
  ```bash
  curl -X POST http://localhost:3000/api/founder/emergency-stop \
    -H "Authorization: Bearer FOUNDER_TOKEN" \
    -d '{ "enable": false }'
  ```
  - [ ] AI requests work again

- [ ] Test 6: Test Founder account
  ```bash
  # Get founder AI budget
  curl http://localhost:3000/api/founder/ai-budget \
    -H "Authorization: Bearer FOUNDER_TOKEN"
  ```
  - [ ] Response includes `monthlyBudget`, `currentSpend`, `remaining`
  - [ ] Founder is free from Business Brain subscription
  - [ ] But founder AI costs are tracked separately

- [ ] Test 7: Test error handling
  - [ ] Request with invalid organization → Error: "Organization not found"
  - [ ] Request with invalid agent → Error: "Agent not found"
  - [ ] Request with no provider configured → Error: "Provider not configured"

### Integration Tests
- [ ] Run test suite
  ```bash
  npm run test
  ```
  - [ ] All provider tests pass
  - [ ] All cost control tests pass
  - [ ] All security tests pass

---

## DEPLOYMENT (Production)

### Environment Setup
- [ ] Set production environment variables
  - [ ] `OPENAI_API_KEY` (production key)
  - [ ] `SUPABASE_SERVICE_ROLE_KEY` (production key)
  - [ ] `NEXT_PUBLIC_SUPABASE_URL` (production URL)
  - [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` (production key)

- [ ] Verify no development API keys in production
- [ ] Verify secrets are in secure environment variable store (not in code)

### Database Deployment
- [ ] Run all SQL migrations on production database
- [ ] Create all required tables
- [ ] Create all indices
- [ ] Verify RLS policies are enforced
- [ ] Backup production database before deployment

### Application Deployment
- [ ] Deploy code to production
  ```bash
  git push main
  # (your CI/CD deploys automatically)
  ```

- [ ] Verify environment variables are set in production
- [ ] Restart application
- [ ] Verify application is running
  ```bash
  curl https://your-app.com/api/health
  ```

### Post-Deployment
- [ ] Make test AI request in production
  ```bash
  curl -X POST https://your-app.com/api/ai/execute \
    -H "Content-Type: application/json" \
    -d '{...}'
  ```

- [ ] Verify cost was recorded
- [ ] Verify kill switch works
- [ ] Monitor error logs for issues
  ```bash
  # Check logs
  tail -f logs/app.log | grep "AI Execute"
  ```

- [ ] Monitor API performance
  - [ ] Average response time < 2 seconds
  - [ ] Error rate < 1%
  - [ ] Cost tracking accuracy verified

---

## MONITORING (After Deployment)

### Daily Checks
- [ ] Check AI execution logs for errors
  ```sql
  SELECT COUNT(*) FROM ai_execution_logs 
  WHERE created_at > NOW() - INTERVAL '24 hours' 
  AND status != 'success';
  ```

- [ ] Check cost tracking accuracy
  ```sql
  SELECT SUM(actual_cost) FROM ai_execution_logs 
  WHERE created_at > NOW() - INTERVAL '24 hours';
  ```

- [ ] Monitor API error rate
  - [ ] Check application logs for errors
  - [ ] Check for rate limit errors from OpenAI/Anthropic
  - [ ] Check for timeout errors

### Weekly Checks
- [ ] Review spending by organization
  ```sql
  SELECT organization_id, SUM(actual_cost) as total_cost 
  FROM ai_execution_logs 
  WHERE created_at > NOW() - INTERVAL '7 days' 
  GROUP BY organization_id;
  ```

- [ ] Review kill switch usage
  ```sql
  SELECT * FROM audit_logs 
  WHERE action LIKE 'emergency_stop%' 
  AND timestamp > NOW() - INTERVAL '7 days';
  ```

- [ ] Verify founder account spending is within budget
  ```sql
  SELECT founder_id, SUM(actual_cost) as total_cost 
  FROM ai_execution_logs 
  WHERE founder_user_id IS NOT NULL 
  GROUP BY founder_id;
  ```

### Monthly Checks
- [ ] Review total platform AI costs
- [ ] Verify pricing is accurate
- [ ] Check if any organizations exceeded budget
- [ ] Review audit logs for suspicious activity

---

## ROLLBACK PLAN

If issues occur after deployment:

### Immediate Action
- [ ] Enable global kill switch
  ```bash
  curl -X POST https://your-app.com/api/founder/emergency-stop \
    -H "Authorization: Bearer FOUNDER_TOKEN" \
    -d '{ "enable": true }'
  ```
  This stops all AI execution immediately while you investigate.

### Investigation
- [ ] Check application logs for errors
- [ ] Check database for corruption
- [ ] Check AI provider API status
- [ ] Check if environment variables are correct

### Rollback Steps
1. Enable kill switch (stop AI execution)
2. Revert code to last known working version
3. Restart application
4. Verify fix works
5. Disable kill switch

---

## SIGN-OFF

### Pre-Deployment Sign-Off
- [ ] All database tables created
- [ ] All environment variables set
- [ ] All tests passing
- [ ] Security verified
- [ ] Backup created

**Signed Off By**: _______________  
**Date**: _______________  

### Post-Deployment Sign-Off
- [ ] Application running in production
- [ ] Test AI request successful
- [ ] Cost tracking verified
- [ ] Kill switch tested
- [ ] Monitoring configured

**Signed Off By**: _______________  
**Date**: _______________  

---

## SUPPORT CONTACTS

**Questions**: Review SPRINT_2_COMPLETION_REPORT.md  
**Issues**: Check application logs and database  
**Emergency**: Enable kill switch immediately  

---

**Status**: Ready for Deployment  
**Last Updated**: 2026-08-25  
**Maintainer**: Business Brain Team
