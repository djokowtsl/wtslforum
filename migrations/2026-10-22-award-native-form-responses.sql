ALTER TABLE award_categories
  ADD COLUMN IF NOT EXISTS form_question_id TEXT;

CREATE TABLE IF NOT EXISTS award_form_response_state (
  cycle_id BIGINT NOT NULL REFERENCES award_cycles(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  response_id TEXT NOT NULL,
  response_fingerprint CHAR(64) NOT NULL,
  response_updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cycle_id, voter_key)
);
