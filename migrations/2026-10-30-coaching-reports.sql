CREATE TABLE IF NOT EXISTS coaching_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  tournament TEXT NOT NULL,
  round_name TEXT NOT NULL,
  player1 TEXT NOT NULL,
  player2 TEXT NOT NULL,
  score TEXT NOT NULL,
  replay_pathname TEXT UNIQUE,
  source_replay_pathname TEXT NOT NULL UNIQUE,
  submitter_consent BOOLEAN NOT NULL CHECK (submitter_consent),
  player1_consent BOOLEAN NOT NULL CHECK (player1_consent),
  player2_consent BOOLEAN NOT NULL CHECK (player2_consent),
  review_confirmed BOOLEAN NOT NULL CHECK (review_confirmed),
  submitter_consent_reference TEXT NOT NULL CHECK (char_length(submitter_consent_reference) BETWEEN 10 AND 300),
  player1_consent_reference TEXT NOT NULL CHECK (char_length(player1_consent_reference) BETWEEN 10 AND 300),
  player2_consent_reference TEXT NOT NULL CHECK (char_length(player2_consent_reference) BETWEEN 10 AND 300),
  consent_recorded_by_discord_id TEXT NOT NULL,
  consent_recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by_discord_id TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unpublished_at TIMESTAMPTZ,
  unpublished_by_discord_id TEXT,
  CHECK (
    (unpublished_at IS NULL AND replay_pathname IS NOT NULL AND unpublished_by_discord_id IS NULL)
    OR
    (unpublished_at IS NOT NULL AND replay_pathname IS NULL AND unpublished_by_discord_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS coaching_reports_public_latest_idx
  ON coaching_reports (published_at DESC, id)
  WHERE submitter_consent
    AND player1_consent
    AND player2_consent
    AND review_confirmed
    AND unpublished_at IS NULL
    AND replay_pathname IS NOT NULL;

REVOKE ALL ON TABLE coaching_reports FROM PUBLIC;
