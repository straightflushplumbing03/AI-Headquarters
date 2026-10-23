-- Sprint 5.1: Missing core tables
--
-- The following tables are referenced by application code but were never
-- created by any migration in the repository:
--   user_roles          - lib/founder/permissions.ts, lib/founder/founder-manager.ts
--                         (founder authorization is impossible without this table)
--   founder_ai_budgets  - lib/founder/founder-manager.ts (set/read budget)
--   company_memory      - lib/ai/outcome-tracker.ts, lib/ai/execution-pipeline.ts,
--                         types/supabase.ts (Row/Insert/Update already typed)
--   company_knowledge   - RLS was enabled in 002_enable_rls.sql for a table that
--                         was never created; also used by the onboarding flow.

-- ============================================================
-- user_roles (founder/global authorization)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('founder', 'support')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Users can read their own role row only.
DROP POLICY IF EXISTS user_roles_self_select ON user_roles;
CREATE POLICY user_roles_self_select ON user_roles
  FOR SELECT USING (user_id = auth.uid());

-- ============================================================
-- founder_ai_budgets (founder account AI budget + spend)
-- ============================================================
CREATE TABLE IF NOT EXISTS founder_ai_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_budget DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (monthly_budget >= 0),
  current_spend DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (current_spend >= 0),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_founder_ai_budgets_user ON founder_ai_budgets(user_id);

ALTER TABLE founder_ai_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS founder_ai_budgets_self ON founder_ai_budgets;
CREATE POLICY founder_ai_budgets_self ON founder_ai_budgets
  FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- company_memory (AI learnings; typed in types/supabase.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS company_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_memory_org ON company_memory(organization_id);
CREATE INDEX IF NOT EXISTS idx_company_memory_org_category ON company_memory(organization_id, category);

ALTER TABLE company_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_memory_org_isolation ON company_memory;
CREATE POLICY company_memory_org_isolation ON company_memory
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- company_knowledge (RLS enabled in 002 but table never created)
-- ============================================================
CREATE TABLE IF NOT EXISTS company_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_knowledge_org ON company_knowledge(organization_id);

ALTER TABLE company_knowledge ENABLE ROW LEVEL SECURITY;

-- Note: 002_enable_rls.sql already defines select/all policies for
-- company_knowledge; they will now attach to the real table.
