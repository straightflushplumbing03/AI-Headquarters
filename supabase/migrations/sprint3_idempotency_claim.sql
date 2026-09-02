-- Sprint 3: atomic idempotency claim
-- Backs the claim-before-execute pattern in ActionExecutionEngine:
-- concurrent requests race on this unique constraint; the winner executes,
-- losers get 23505 and are blocked as duplicates.

ALTER TABLE autonomous_actions
  DROP CONSTRAINT IF EXISTS autonomous_actions_idempotency_org_unique;

ALTER TABLE autonomous_actions
  ADD CONSTRAINT autonomous_actions_idempotency_org_unique
  UNIQUE (idempotency_key, organization_id);

CREATE INDEX IF NOT EXISTS idx_autonomous_actions_idempotency
  ON autonomous_actions(idempotency_key, organization_id);
