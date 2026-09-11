-- ============================================================================
-- TASKS.WORKFLOW_ID FK — matches production schema; was never captured as a
-- migration (discovered during Sprint 5.3 P3 STEP 4 fresh-DB verification).
--
-- Production fact (read-only information_schema extraction from the live
-- project): tasks.workflow_id references task_workflows(id) ON DELETE SET NULL.
-- task_workflows is created by 03_phase3_autonomous_workforce.sql, which sorts
-- after this file, so the FK can only be added here.
--
-- IF NOT EXISTS guard: the parent column and table exist by this point; the
-- constraint is added only if absent (idempotent).
-- ============================================================================
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'task_workflows'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks' and column_name = 'workflow_id'
  ) and not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public' and constraint_type = 'FOREIGN KEY'
      and table_name = 'tasks' and constraint_name = 'tasks_workflow_id_fkey'
  ) then
    alter table tasks
      add constraint tasks_workflow_id_fkey
      foreign key (workflow_id) references task_workflows(id)
      on delete set null;
  end if;
end
$$;
