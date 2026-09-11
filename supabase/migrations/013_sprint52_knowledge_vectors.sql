-- ============================================================================
-- Sprint 5.2: pgvector knowledge foundation
-- ============================================================================
--
-- GOVERNANCE: this migration is the single owner of embedding infrastructure.
-- It upgrades the EXISTING organizational_knowledge table (migration 03) with
-- versioned embedding columns and quality metadata. No new knowledge tables
-- are created; overlapping systems keep distinct responsibilities:
--
--   organizational_knowledge  = canonical semantic knowledge store (this file)
--   company_memory            = durable business-memory ledger (see 014)
--   company_knowledge         = user-curated documents (onboarding uploads)
--   strategic_learnings / discovered_patterns = Phase-4 analytics artifacts
--
-- Embedding model contract:
--   OpenAI text-embedding-3-small → 1536 dimensions, cost $0.02 / 1M tokens.
--   The dimension is NOT hard-coded into the column type semantics blindly:
--   we store the model + dimension per row so future re-embedding with a
--   different model is a supported operation (compare embedding_model +
--   embedding_version, re-embed in place).
--
-- pgvector: Supabase ships the `vector` extension; enabled here idempotently.
-- If a self-hosted Postgres lacks pgvector the CREATE EXTENSION will fail and
-- this migration must not be applied to that environment.

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- 1. Versioned embedding columns + quality metadata on organizational_knowledge
-- ============================================================================
ALTER TABLE organizational_knowledge
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS embedding_version TEXT,
  ADD COLUMN IF NOT EXISTS embedding_dimension INTEGER,
  ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS embedding_error TEXT,
  ADD COLUMN IF NOT EXISTS embedding_attempts INTEGER NOT NULL DEFAULT 0,

  -- Knowledge quality metadata (Sprint 5.2 Part 8)
  ADD COLUMN IF NOT EXISTS source_type TEXT
    CHECK (source_type IN ('ai_generated', 'task_outcome', 'human_input', 'external', 'system')),
  ADD COLUMN IF NOT EXISTS importance DECIMAL(3,2) NOT NULL DEFAULT 0.5
    CHECK (importance >= 0 AND importance <= 1),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'archived', 'rejected')),
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_after TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  -- JSONB metadata is referenced by search_org_knowledge() below; no prior
  -- migration ever created it, so a fresh push failed with 42703 here.
  ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Backfill the existing embeddings_pending flag into source_type where missing.
UPDATE organizational_knowledge
SET source_type = COALESCE(source_type, 'task_outcome')
WHERE source_type IS NULL;

-- ============================================================================
-- 2. Embedding state machine (fail-closed, retry-friendly)
-- ============================================================================
--   pending    -> queued for embedding (embeddings_pending = true)
--   embedded   -> vector present, model recorded
--   failed     -> embedding_error recorded, attempts counted, retriable
COMMENT ON COLUMN organizational_knowledge.embedding IS
  'pgvector embedding; NULL until successfully embedded';

COMMENT ON COLUMN organizational_knowledge.embedding_error IS
  'Last embedding failure reason; NULL when embedded or pending';

-- ============================================================================
-- 3. Indexes
-- ============================================================================
-- Exact (KNN-exact) ivfflat index: safe default for the expected scale
-- (thousands of rows per org). Revisit HNSW when any org exceeds ~100k rows.
-- IMPORTANT: ivfflat requires rows to exist before index creation for good
-- recall; creating it empty defaults lists=1 which is still correct, just
-- slower until re-analyzed. We create it anyway for determinism on fresh DBs
-- and REINDEX after bulk backfills.
CREATE INDEX IF NOT EXISTS idx_org_knowledge_embedding
  ON organizational_knowledge
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Quality/filter indexes: every retrieval query filters org + status first.
CREATE INDEX IF NOT EXISTS idx_org_knowledge_org_status
  ON organizational_knowledge (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_org_knowledge_org_pending
  ON organizational_knowledge (organization_id, embeddings_pending)
  WHERE embeddings_pending = true;
CREATE INDEX IF NOT EXISTS idx_org_knowledge_content_hash
  ON organizational_knowledge (organization_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_org_knowledge_last_accessed
  ON organizational_knowledge (organization_id, last_accessed_at);

-- Keyword search index for hybrid retrieval (English FTS on title+content).
CREATE INDEX IF NOT EXISTS idx_org_knowledge_fts
  ON organizational_knowledge
  USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, '')));

-- ============================================================================
-- 4. Deduplication helper: content hash
-- ============================================================================
-- sha256 of normalized content; computed by the ingestion service.
-- The unique partial index below enforces "no duplicate knowledge per org"
-- for rows that carry a hash. Normalization lives in app code (trim, collapse
-- whitespace, lowercase) so the DB constraint stays simple.
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_knowledge_hash_unique
  ON organizational_knowledge (organization_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- ============================================================================
-- 5. Semantic search RPC — organization isolation enforced IN THE DATABASE
-- ============================================================================
-- The RPC takes p_organization_id explicitly and filters on it BEFORE ranking.
-- Callers must pass the org id resolved server-side from the session; RLS on
-- organizational_knowledge additionally constrains results for user-scoped
-- clients (defense in depth: app authz + RPC filter + RLS).
--
-- Hybrid mode: when p_query_text is provided, keyword relevance (ts_rank_cd)
-- is blended with cosine similarity:
--   score = 0.7 * cosine_similarity + 0.3 * normalized_ts_rank
--
CREATE OR REPLACE FUNCTION search_org_knowledge(
  p_query_embedding vector(1536),
  p_organization_id uuid,
  p_query_text TEXT DEFAULT NULL,
  p_match_count INTEGER DEFAULT 8,
  p_min_similarity DECIMAL DEFAULT 0.20,
  p_min_confidence DECIMAL DEFAULT 0.0,
  p_statuses TEXT[] DEFAULT ARRAY['active'],
  p_categories TEXT[] DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title TEXT,
  content TEXT,
  knowledge_type TEXT,
  category TEXT,
  tags TEXT[],
  confidence DECIMAL,
  importance DECIMAL,
  source TEXT,
  source_type TEXT,
  similarity DECIMAL,
  keyword_rank DECIMAL,
  combined_score DECIMAL,
  embedding_model TEXT,
  embedded_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB
)
LANGUAGE sql
STABLE
AS $$
  WITH keyword_matches AS (
    SELECT
      k.id,
      ts_rank_cd(
        to_tsvector('english', coalesce(k.title, '') || ' ' || coalesce(k.content, '')),
        plainto_tsquery('english', p_query_text)
      ) AS rank
    FROM organizational_knowledge k
    WHERE p_query_text IS NOT NULL
      AND k.organization_id = p_organization_id
      AND to_tsvector('english', coalesce(k.title, '') || ' ' || coalesce(k.content, ''))
          @@ plainto_tsquery('english', p_query_text)
  )
  SELECT
    k.id,
    k.title,
    k.content,
    k.knowledge_type,
    k.category,
    k.tags,
    k.confidence,
    k.importance,
    k.source,
    k.source_type,
    1 - (k.embedding <=> p_query_embedding) AS similarity,
    km.rank AS keyword_rank,
    -- Hybrid blend when keyword info exists; pure semantic otherwise.
    CASE
      WHEN km.rank IS NOT NULL THEN
        (0.7 * (1 - (k.embedding <=> p_query_embedding))) + (0.3 * LEAST(km.rank * 10.0, 1.0))
      ELSE
        (1 - (k.embedding <=> p_query_embedding))
    END AS combined_score,
    k.embedding_model,
    k.embedded_at,
    k.created_at,
    k.metadata
  FROM organizational_knowledge k
  LEFT JOIN keyword_matches km ON km.id = k.id
  WHERE k.organization_id = p_organization_id          -- tenant filter FIRST
    AND k.embedding IS NOT NULL                        -- only embedded rows
    AND k.status = ANY (p_statuses)
    AND (p_categories IS NULL OR k.category = ANY (p_categories))
    AND (p_tags IS NULL OR k.tags && p_tags)
    AND (k.confidence IS NULL OR k.confidence >= p_min_confidence)
    AND (1 - (k.embedding <=> p_query_embedding)) >= p_min_similarity
  ORDER BY combined_score DESC
  LIMIT LEAST(p_match_count, 50);
$$;

-- ============================================================================
-- 6. Track access for retrieval-quality analytics (importance signals later)
-- ============================================================================
CREATE OR REPLACE FUNCTION record_knowledge_access(p_knowledge_ids uuid[])
RETURNS void
LANGUAGE sql
AS $$
  UPDATE organizational_knowledge
  SET access_count = access_count + 1,
      last_accessed_at = NOW()
  WHERE id = ANY (p_knowledge_ids);
$$;

-- ============================================================================
-- 7. Keep RLS enabled (03 already created the org-isolation policy; re-assert)
-- ============================================================================
ALTER TABLE organizational_knowledge ENABLE ROW LEVEL SECURITY;
