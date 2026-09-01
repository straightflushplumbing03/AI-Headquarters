-- Phase 5 Hardening: Embedding / Semantic Knowledge Support
--
-- Adds pgvector extension and embedding columns to organizational_knowledge.
-- All changes are conditional (IF NOT EXISTS / IF EXISTS) so this migration
-- is safe to re-run.
--
-- If pgvector is not available in your Supabase project, the application
-- continues to function normally — embeddings_pending will remain true and
-- semantic search will return empty results until pgvector is enabled.

-- Enable pgvector extension (requires Supabase Pro or manual enablement)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding columns to organizational_knowledge (Phase 3 table)
ALTER TABLE organizational_knowledge
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS embedding_error TEXT,
  ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMP WITH TIME ZONE;

-- embeddings_pending may already exist from Phase 3; ensure it's there
ALTER TABLE organizational_knowledge
  ADD COLUMN IF NOT EXISTS embeddings_pending BOOLEAN NOT NULL DEFAULT true;

-- Index for approximate nearest-neighbour search (IVFFlat)
-- Only create if vector extension is available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
      ON organizational_knowledge USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
  END IF;
END;
$$;

-- Add embedding support to strategic_learnings
ALTER TABLE strategic_learnings
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_model TEXT,
  ADD COLUMN IF NOT EXISTS embedding_error TEXT,
  ADD COLUMN IF NOT EXISTS embeddings_pending BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMP WITH TIME ZONE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE INDEX IF NOT EXISTS idx_strategic_learnings_embedding
      ON strategic_learnings USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
  END IF;
END;
$$;

-- RPC function for vector similarity search with organization isolation.
-- Called by EmbeddingService.similaritySearch().
-- Returns rows from the specified table ordered by cosine similarity.
CREATE OR REPLACE FUNCTION match_knowledge_by_embedding(
  p_table TEXT,
  p_organization_id UUID,
  p_embedding TEXT,       -- JSON-encoded vector (avoids dynamic typing issues)
  p_match_threshold FLOAT DEFAULT 0.7,
  p_match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_embedding vector(1536);
BEGIN
  -- Parse the JSON-encoded vector
  v_embedding := p_embedding::vector;

  IF p_table = 'organizational_knowledge' THEN
    RETURN QUERY
      SELECT
        ok.id,
        ok.organization_id,
        1 - (ok.embedding <=> v_embedding) AS similarity
      FROM organizational_knowledge ok
      WHERE ok.organization_id = p_organization_id
        AND ok.embedding IS NOT NULL
        AND (1 - (ok.embedding <=> v_embedding)) >= p_match_threshold
      ORDER BY ok.embedding <=> v_embedding
      LIMIT p_match_count;

  ELSIF p_table = 'strategic_learnings' THEN
    RETURN QUERY
      SELECT
        sl.id,
        sl.organization_id,
        1 - (sl.embedding <=> v_embedding) AS similarity
      FROM strategic_learnings sl
      WHERE sl.organization_id = p_organization_id
        AND sl.embedding IS NOT NULL
        AND (1 - (sl.embedding <=> v_embedding)) >= p_match_threshold
      ORDER BY sl.embedding <=> v_embedding
      LIMIT p_match_count;

  END IF;
END;
$$;

-- Grant execute to authenticated users (RLS still enforced via organization_id filter)
GRANT EXECUTE ON FUNCTION match_knowledge_by_embedding TO authenticated;
