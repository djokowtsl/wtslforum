-- Default forum identity for accounts with multiple approved tour claims.
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_player_claim_id BIGINT;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_default_player_claim_id_fkey
    FOREIGN KEY (default_player_claim_id) REFERENCES player_claims(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Existing accounts start with their earliest approved identity; members can change this in Profile.
UPDATE users u
SET default_player_claim_id = (
  SELECT c.id FROM player_claims c
  WHERE c.user_id = u.id AND c.status = 'approved'
  ORDER BY c.created_at ASC, c.id ASC LIMIT 1
)
WHERE u.default_player_claim_id IS NULL;
