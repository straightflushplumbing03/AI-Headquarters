-- AI Authority Engine: distinguish a MISSING meta description from a DUPLICATE one.
--
-- Migration 021 reused 'duplicate_meta_description' as the issue type for pages
-- with no description at all. That conflates two different defects: a page with
-- no description needs one written, while a shared description means two pages
-- need to be differentiated. Because the duplicate report counts rows by issue
-- type, the mislabel also inflated duplicate counts with pages that had no
-- description to duplicate.
--
-- Widening the allowed set is additive and safe: existing rows keep their
-- current values.

ALTER TABLE authority_technical_issues
  DROP CONSTRAINT IF EXISTS authority_technical_issues_issue_type_check;

ALTER TABLE authority_technical_issues
  ADD CONSTRAINT authority_technical_issues_issue_type_check
  CHECK (issue_type IN (
    'broken_link', 'http_error', 'redirect_chain', 'canonical_mismatch',
    'duplicate_title', 'duplicate_meta_description', 'missing_title',
    'missing_meta_description', 'missing_h1', 'missing_schema', 'invalid_schema',
    'orphan_page', 'sitemap_problem', 'robots_issue', 'slow_page', 'mobile_issue',
    'thin_content', 'doorway_page_risk', 'duplicate_content'
  ));

-- Reclassify historical rows recorded before the fix so the duplicate report
-- reflects reality. Scoped narrowly: only rows whose detail says the page has no
-- description are moved.
UPDATE authority_technical_issues
SET issue_type = 'missing_meta_description'
WHERE issue_type = 'duplicate_meta_description'
  AND detail ILIKE '%no meta description%';