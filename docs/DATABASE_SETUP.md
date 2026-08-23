# Phase 2 Database Migration

## Run Migrations

```bash
# Push migrations to Supabase
npm run db:push

# Pull current schema
npm run db:pull
```

## Tables Created

### AI Configuration & Execution
- `ai_provider_config` - Provider setup
- `ai_execution_logs` - Audit trail
- `ai_usage_limits` - Budget tracking

### Agent Management
- `agent_system_prompts` - Agent instructions

### Organization
- `company_goals` - Goals and objectives
- `approval_requests` - Pending decisions
- `task_outcomes` - Results and learnings

## RLS Policies

All new tables have organization isolation:

```sql
-- Pattern for all tables
CREATE POLICY "table_org_isolation"
  ON table_name
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members 
      WHERE user_id = auth.uid()
    )
  );
```

## Cost Tracking

Every execution stored with:
- Provider and model
- Input/output token counts
- Estimated cost
- Execution time
- Status (success/failed/partial)

## Accessing Data

### Get AI Execution History

```typescript
const { data: logs } = await supabase
  .from('ai_execution_logs')
  .select('*')
  .eq('organization_id', organizationId)
  .order('created_at', { ascending: false })
```

### Check Budget Status

```typescript
const { data: limits } = await supabase
  .from('ai_usage_limits')
  .select('*')
  .eq('organization_id', organizationId)
  .single()
```

### Get Task Outcomes

```typescript
const { data: outcomes } = await supabase
  .from('task_outcomes')
  .select('*')
  .eq('organization_id', organizationId)
  .order('created_at', { ascending: false })
```
