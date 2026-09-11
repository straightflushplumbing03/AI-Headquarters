-- ============================================================================
-- Sprint 5.2: Company memory architecture (Part 9)
-- ============================================================================
--
-- PURPOSE of company_memory (architecture definition, not just schema):
--
--   company_memory is the DURABLE ORGANIZATIONAL MEMORY LEDGER: high-value,
--   curated business knowledge learned from actual business activity —
--   proven strategies, failed strategies, customer patterns, business rules,
--   strategic decisions and their outcomes, operational lessons.
--
--   It is NOT an automatic AI-response dump. Writes must go through
--   lib/knowledge/company-memory.ts which validates source, confidence and
--   evidence before persisting. Casual content stays in
--   organizational_knowledge (ephemeral findings) or company_knowledge
--   (human documents).
--
--   Relationship to organizational_knowledge:
--     organizational_knowledge = semantic retrieval store (vectors, hybrid
--       search) for ANY knowledge the AI may need in context.
--     company_memory = curated, durable, reviewable business memory with
--       confidence/validity lifecycle. The future learning system (Phase 7
--       integration) promotes significant learnings INTO company_memory.
--     A memory row MAY reference the organizational_knowledge row it was
--     promoted from via source_knowledge_id.
--
--   The table already exists (000_missing_core_tables.sql / 010). This
--   migration upgrades it with the quality/lifecycle columns required by
--   Sprint 5.2 Part 9 without redefining existing columns.

-- ============================================================================
-- 1. Quality + lifecycle columns
-- ============================================================================
ALTER TABLE company_memory
  ADD COLUMN IF NOT EXISTS source_type TEXT
    CHECK (source_type IN ('ai_generated', 'task_outcome', 'human_input', 'external', 'system')),
  ADD COLUMN IF NOT EXISTS source_ref TEXT,
  ADD COLUMN IF NOT EXISTS source_knowledge_id uuid
    REFERENCES organizational_knowledge(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS evidence JSONB,
  ADD COLUMN IF NOT EXISTS confidence DECIMAL(3,2)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  ADD COLUMN IF NOT EXISTS importance DECIMAL(3,2) NOT NULL DEFAULT 0.5
    CHECK (importance >= 0 AND importance <= 1),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'under_review', 'validated', 'retired', 'expired')),
  ADD COLUMN IF NOT EXISTS review_after TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Normalize pre-existing rows (from outcome-tracker/execution-pipeline writes).
UPDATE company_memory
SET source_type = COALESCE(source_type, 'system')
WHERE source_type IS NULL;

-- ============================================================================
-- 2. Deduplication + query indexes
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_memory_hash_unique
  ON company_memory (organization_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_company_memory_org_status
  ON company_memory (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_company_memory_org_importance
  ON company_memory (organization_id, importance DESC);
CREATE INDEX IF NOT EXISTS idx_company_memory_review_due
  ON company_memory (organization_id, review_after)
  WHERE review_after IS NOT NULL;

-- ============================================================================
-- 3. Auto-expiry: memories past review_after become 'expired' (fail-safe:
--    stale low-quality memory must not masquerade as current truth). A
--    Sprint 5.3 worker will call this RPC on a schedule.
-- ============================================================================
CREATE OR REPLACE FUNCTION expire_stale_memories()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected INTEGER := 0;
BEGIN
  UPDATE company_memory
    SET status = 'expired',
        updated_at = NOW()
    WHERE status = 'active'
      AND review_after IS NOT NULL
      AND review_after < NOW();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END $$;

-- ============================================================================
-- 4. RLS re-assertion (000/010 already created the org-isolation policy)
-- ============================================================================
ALTER TABLE company_memory ENABLE ROW LEVEL SECURITY;
