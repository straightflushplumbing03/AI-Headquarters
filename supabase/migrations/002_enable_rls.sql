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
create policy "Authenticated users can create organizations"
  on public.organizations for insert
  with check (auth.role() = 'authenticated');

-- Organization Members RLS Policies
create policy "Users can view their organization members"
  on public.organization_members for select
  using (
    exists (
      select 1 from public.organization_members om2
      where om2.organization_id = organization_members.organization_id
      and om2.user_id = auth.uid()
    )
  );

create policy "Org owners can manage members"
  on public.organization_members for all
  using (
    exists (
      select 1 from public.organization_members om2
      where om2.organization_id = organization_members.organization_id
      and om2.user_id = auth.uid()
      and om2.role = 'owner'
    )
  );

-- Departments RLS Policies
create policy "Users can view departments of their organizations"
  on public.departments for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = departments.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

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
create policy "Users can view agents of their organizations"
  on public.agents for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = agents.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

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
create policy "Users can view tasks of their organizations"
  on public.tasks for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = tasks.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

create policy "Org members can create tasks"
  on public.tasks for insert
  with check (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = tasks.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

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
create policy "Users can view activity of their organizations"
  on public.activity_events for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = activity_events.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

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
create policy "Users can view knowledge of their organizations"
  on public.company_knowledge for select
  using (
    exists (
      select 1 from public.organization_members
      where organization_members.organization_id = company_knowledge.organization_id
      and organization_members.user_id = auth.uid()
    )
  );

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
