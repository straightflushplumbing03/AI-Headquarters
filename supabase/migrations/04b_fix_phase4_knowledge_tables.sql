-- Fix Phase 4: Create missing strategic_learnings and discovered_patterns tables
-- These tables are referenced in lib/phase4/enhanced-knowledge-system.ts but were missing from migration 04

-- Strategic Learnings: Records key learnings, findings, and insights discovered during operations
CREATE TABLE IF NOT EXISTS strategic_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Core learning content
  topic TEXT NOT NULL,
  learning TEXT NOT NULL,
  context TEXT, -- Additional context about when/why this learning emerged
  evidence JSONB, -- Supporting evidence: metrics, examples, observations
  
  -- Learning quality and applicability
  confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1), -- 0-1 scale
  applicability TEXT CHECK (applicability IN ('universal', 'service_specific', 'market_specific', 'seasonal', 'experimental')),
  impact_area TEXT, -- seo, conversion, content, market, etc.
  
  -- Searchability
  searchable_text TEXT GENERATED ALWAYS AS (topic || ' ' || learning || ' ' || COALESCE(context, '')) STORED,
  
  -- Metadata
  source_agent TEXT, -- Which agent discovered this?
  source_system TEXT, -- Which system? (seo_experiments, competitor_watch, website_intelligence, etc.)
  source_data JSONB, -- Raw source data
  
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT strategic_learnings_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Discovered Patterns: Tracks recurring patterns and their effectiveness
CREATE TABLE IF NOT EXISTS discovered_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Pattern definition
  pattern_name TEXT NOT NULL,
  description TEXT NOT NULL,
  pattern_category TEXT CHECK (pattern_category IN ('customer_behavior', 'market_trend', 'operational', 'conversion', 'traffic', 'competitive', 'seasonal', 'custom')),
  
  -- Pattern conditions (when does this pattern occur?)
  conditions JSONB NOT NULL, -- Array of conditions that trigger pattern
  
  -- Pattern effectiveness
  expected_outcome TEXT, -- What happens when pattern occurs?
  effectiveness DECIMAL(3,2) CHECK (effectiveness >= 0 AND effectiveness <= 1), -- 0-1 scale (0-100%)
  confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  
  -- Evidence and testing
  times_observed INTEGER DEFAULT 0, -- How many times verified?
  success_rate DECIMAL(5,2), -- Percentage of times pattern led to expected outcome
  supporting_evidence JSONB, -- Examples and detailed evidence
  
  -- Application
  use_cases TEXT[], -- How should this pattern be used?
  recommended_actions JSONB, -- Suggested actions when pattern is detected
  contraindications JSONB, -- When NOT to use this pattern
  
  -- Temporal applicability
  applicable_seasons TEXT[], -- Which seasons? (all, spring, summer, fall, winter)
  temporal_scope TEXT CHECK (temporal_scope IN ('always', 'seasonal', 'limited_time', 'emerging', 'deprecated')),
  
  -- Metadata
  first_discovered_at TIMESTAMP WITH TIME ZONE,
  last_verified_at TIMESTAMP WITH TIME ZONE,
  verified_count INTEGER DEFAULT 0,
  source_agent TEXT,
  source_system TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT discovered_patterns_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_strategic_learnings_org ON strategic_learnings(organization_id);
CREATE INDEX IF NOT EXISTS idx_strategic_learnings_searchable ON strategic_learnings USING gin(to_tsvector('english', searchable_text));
CREATE INDEX IF NOT EXISTS idx_strategic_learnings_source ON strategic_learnings(source_system, source_agent);
CREATE INDEX IF NOT EXISTS idx_strategic_learnings_created ON strategic_learnings(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discovered_patterns_org ON discovered_patterns(organization_id);
CREATE INDEX IF NOT EXISTS idx_discovered_patterns_category ON discovered_patterns(pattern_category);
CREATE INDEX IF NOT EXISTS idx_discovered_patterns_effectiveness ON discovered_patterns(effectiveness DESC);
CREATE INDEX IF NOT EXISTS idx_discovered_patterns_temporal ON discovered_patterns(temporal_scope);

-- Row Level Security

-- Strategic Learnings RLS
ALTER TABLE strategic_learnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategic_learnings_org_isolation ON strategic_learnings;
CREATE POLICY strategic_learnings_org_isolation ON strategic_learnings
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- Discovered Patterns RLS
ALTER TABLE discovered_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS discovered_patterns_org_isolation ON discovered_patterns;
CREATE POLICY discovered_patterns_org_isolation ON discovered_patterns
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON strategic_learnings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON discovered_patterns TO authenticated;
