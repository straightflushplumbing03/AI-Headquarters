-- Sprint 5.1: Missing core tables referenced by existing code.
-- These tables were referenced by services but never created by any migration:
--   user_roles          (lib/founder/permissions.ts, lib/founder/founder-manager.ts)
--   founder_ai_budgets  (lib/founder/founder-manager.ts, app/api/founder/ai-budget/route.ts)
--   company_memory      (lib/ai/outcome-tracker.ts, lib/ai/execution-pipeline.ts, types/supabase.ts)
--   company_knowledge   (RLS enabled in 002_enable_rls.sql but table never created)
--
-- Conventions follow the existing migrations: uuid PKs, organization_id FK to
-- organizations with ON DELETE CASCADE, TIMESTAMPS, IF NOT EXISTS, RLS via the
-- organization_members membership subquery.

-- ============================================================================
-- USER_ROLES: platform-level roles (founder). NOT org-scoped by design:
-- founder is a global platform role. Only founder themselves can read/write;
-- no client-side writes ever (service_role only in practice). We add a
-- fail-closed SELECT policy (self-read only) so regular users cannot enumerate
-- founders, and no public INSERT/UPDATE/DELETE policies at all.
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('founder')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT user_roles_user_role_unique UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Fail-closed: users may only see their own role rows. Founder administration
-- happens via service-role (migration/seed), never via client policies.
CREATE POLICY user_roles_self_select ON user_roles
  FOR SELECT USING (user_id = auth.uid());

-- ============================================================================
-- FOUNDER_AI_BUDGETS: per-founder AI spend control (user-scoped, not org).
-- Existing code (lib/founder/founder-manager.ts) uses columns:
--   user_id, monthly_budget, current_spend
-- ============================================================================
CREATE TABLE IF NOT EXISTS founder_ai_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_budget NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_budget >= 0),
  current_spend NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (current_spend >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT founder_budget_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_founder_budgets_user_id ON founder_ai_budgets(user_id);

ALTER TABLE founder_ai_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY founder_budgets_self ON founder_ai_budgets
  FOR ALL USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'founder'
    )
  );

-- ============================================================================
-- COMPANY_MEMORY: org-scoped knowledge/memory (used by outcome-tracker and
-- execution-pipeline). Mirrors types/supabase.ts shape.
-- ============================================================================
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

CREATE POLICY company_memory_org_isolation ON company_memory
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- COMPANY_KNOWLEDGE: org knowledge base. RLS was already enabled in
-- 002_enable_rls.sql (policies exist there) — this migration creates the
-- missing table itself with the same column shape 002's policies assume.
-- ============================================================================
CREATE TABLE IF NOT EXISTS company_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  metadata JSONB,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_knowledge_org ON company_knowledge(organization_id);

-- 002_enable_rls.sql already enabled RLS and created the org-isolation
-- policies for this table; enabling again is idempotent-safe.
ALTER TABLE company_knowledge ENABLE ROW LEVEL SECURITY;
