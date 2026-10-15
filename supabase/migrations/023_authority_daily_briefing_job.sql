-- AI Authority Engine: register the daily business summary job type.
--
-- The 6:00 AM Pacific cadence (lib/jobs/maintenance.ts) enqueues a concise
-- daily business summary alongside the collection and parsing jobs. The job
-- type must be registered in the CHECK constraint or the enqueue fails with a
-- constraint violation.
--
-- Additive and re-runnable: the constraint is dropped and recreated with the
-- existing value set plus the new one, following the pattern in 016 and 021.
-- No rows are modified.

BEGIN;

ALTER TABLE background_jobs DROP CONSTRAINT IF EXISTS background_jobs_job_type_check;
ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_job_type_check
  CHECK (job_type IN (
    'approval_expiration_sweep',
    'embedding_backfill',
    'execute_autonomous_action',
    'budget_reconciliation_sweep',
    -- AI Authority Engine
    'authority_query_execution',
    'authority_response_parsing',
    'authority_competitor_monitor',
    'authority_website_crawl',
    'authority_search_console_sync',
    'authority_gbp_sync',
    'authority_scoring',
    'authority_recommendation_generation',
    'authority_experiment_evaluation',
    'authority_data_quality_sweep',
    -- Daily business summary (6:00 AM Pacific cadence)
    'authority_daily_briefing'
  ));

COMMIT;
