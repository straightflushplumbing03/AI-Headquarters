-- ============================================================================
-- BOOTSTRAP: base tables whose DDL was never committed as a migration.
--
-- Context (Sprint 5.3 P3 STEP 4, fresh-DB verification on a dedicated TEST
-- project): `supabase db push` to a fresh database failed with
-- `relation "organizations" does not exist` — the base tables (organizations,
-- departments, agents, tasks, organization_members) were applied to the
-- production database directly and never captured in the repo. Ten migrations
-- reference them via FK, and 002_enable_rls.sql enables RLS on them.
--
-- This file reproduces those tables faithfully — column-by-column facts
-- extracted read-only from the live production database (information_schema)
-- so a fresh database converges to the same schema. No data is copied; no
-- destructive statements; IF NOT EXISTS throughout.
--
-- Deviation note: tasks.workflow_id is created as a plain uuid column here
-- (no FK) because task_workflows does not exist yet at this point in the
-- chain; no committed migration ever adds that FK (production drift).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- ORGANIZATIONS (multi-tenant root)
-- ============================================================================
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  website text,
  industry text,
  description text,
  logo_url text,
  primary_color text not null default '#6366f1',
  secondary_color text not null default '#8b5cf6',
  accent_color text not null default '#22d3ee',
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organizations_slug_key on organizations (slug);

-- ============================================================================
-- DEPARTMENTS (virtual headquarters floor-plan)
-- ============================================================================
create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  color text not null default '#6366f1',
  icon text,
  position_x numeric,
  position_y numeric,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- AGENTS (AI workforce members)
-- ============================================================================
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  name text not null,
  role text not null,
  description text,
  avatar_url text,
  capabilities text[],
  status text not null default 'available',
  active boolean not null default true,
  system_instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- TASKS
-- ============================================================================
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid references agents(id) on delete set null,
  parent_task_id uuid references tasks(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'medium',
  status text not null default 'queued',
  input jsonb,
  result text,
  error text,
  approval_state text not null default 'pending',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  workflow_id uuid,
  priority_score numeric,
  depends_on uuid references tasks(id) on delete set null,
  approval_required boolean default false,
  approval_status text,
  evidence text[],
  learning jsonb,
  estimated_duration_minutes integer,
  estimated_cost numeric,
  actual_cost numeric,
  confidence_score numeric
);

-- ============================================================================
-- ORGANIZATION_MEMBERS (membership + RBAC; the RLS workhorse)
-- ============================================================================
create table if not exists organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now()
);

-- Unique membership per (org, user) — matches prod semantics
create unique index if not exists organization_members_org_user_key
  on organization_members (organization_id, user_id);
