-- Enable RLS
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.departments enable row level security;
alter table public.agents enable row level security;
alter table public.tasks enable row level security;
alter table public.activity_events enable row level security;
alter table public.company_knowledge enable row level security;

-- Organizations RLS Policies
-- Users can view their own organizations
drop policy if exists "Users can view their organizations" on public.organizations;
create policy "Users can view their organizations"
  on public.organizations for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = organizations.id
      and organization_members.user_id = auth.uid()
    )
  );

-- Only org owners/admins can update
drop policy if exists "Org owners and admins can update" on public.organizations;
create policy "Org owners and admins can update"
  on public.organizations for update
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = organizations.id
      and organization_members.user_id = auth.uid()
      and organization_members.role in ('owner', 'admin')
    )
  );

-- Only authenticated users can insert (will be restricted by application logic)
drop policy if exists "Authenticated users can create organizations" on public.organizations;
create policy "Authenticated users can create organizations"
  on public.organizations for insert
  with check (auth.role() = 'authenticated');

-- Organization Members RLS Policies

-- Recursion-free owner check: SECURITY DEFINER bypasses RLS, so policies
-- on organization_members can use it without infinite recursion.(Legacy
-- bugfix: the old self-referential EXISTS policies caused `infinite recursion`
-- under real RLS (authenticated/service roles forever.) The direct user_id =
-- auth.uid() select policy keeps member listing recursion-free;owner
-- management delegates to this helper instead of re-querying the table.

create or replace function public.is_org_owner(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $fn$
  select exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.role = 'owner'
  );
$fn$;
grant execute on function public.is_org_owner(uuid) to authenticated, service_role;

drop policy if exists "Users can view their organization members" on public.organization_members;
create policy "Users can view their organization members"
  on public.organization_members for select
 using (user_id = auth.uid());

drop policy if exists "Org owners can manage members" on public.organization_members;
create policy "Org owners can manage members"
  on public.organization_members for all
 using (public.is_org_owner(organization_id))
 with check (public.is_org_owner(organization_id));

-- Departments RLS Policies
drop policy if exists "Users can view departments of their organizations" on public.departments;
create policy "Users can view departments of their organizations"
  on public.departments for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = departments.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

drop policy if exists "Org admins can manage departments" on public.departments;
create policy "Org admins can manage departments"
  on public.departments for all
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = departments.organization_id
      and organization_members.user_id = auth.uid()
      and organization_members.role in ('owner', 'admin')
    )
  );

-- Agents RLS Policies
drop policy if exists "Users can view agents of their organizations" on public.agents;
create policy "Users can view agents of their organizations"
  on public.agents for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = agents.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

drop policy if exists "Org admins can manage agents" on public.agents;
create policy "Org admins can manage agents"
  on public.agents for all
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = agents.organization_id
      and organization_members.user_id = auth.uid()
      and organization_members.role in ('owner', 'admin')
    )
  );

-- Tasks RLS Policies
drop policy if exists "Users can view tasks of their organizations" on public.tasks;
create policy "Users can view tasks of their organizations"
  on public.tasks for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = tasks.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

drop policy if exists "Org members can create tasks" on public.tasks;
create policy "Org members can create tasks"
  on public.tasks for insert
  with check (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = tasks.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

drop policy if exists "Org admins can manage tasks" on public.tasks;
create policy "Org admins can manage tasks"
  on public.tasks for update
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = tasks.organization_id
      and organization_members.user_id = auth.uid()
      and organization_members.role in ('owner', 'admin')
    )
  );

-- Activity Events RLS Policies
drop policy if exists "Users can view activity of their organizations" on public.activity_events;
create policy "Users can view activity of their organizations"
  on public.activity_events for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = activity_events.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

drop policy if exists "Org members can log activity" on public.activity_events;
create policy "Org members can log activity"
  on public.activity_events for insert
  with check (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = activity_events.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

-- Company Knowledge RLS Policies
drop policy if exists "Users can view knowledge of their organizations" on public.company_knowledge;
create policy "Users can view knowledge of their organizations"
  on public.company_knowledge for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = company_knowledge.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

drop policy if exists "Org admins can manage knowledge" on public.company_knowledge;
create policy "Org admins can manage knowledge"
  on public.company_knowledge for all
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = company_knowledge.organization_id
      and organization_members.user_id = auth.uid()
      and organization_members.role in ('owner', 'admin')
    )
  );
