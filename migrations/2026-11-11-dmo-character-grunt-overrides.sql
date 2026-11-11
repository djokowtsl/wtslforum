CREATE TABLE IF NOT EXISTS dmo_character_grunt_profiles (
  profile_key TEXT PRIMARY KEY,
  character_name TEXT NOT NULL,
  grunt_group TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(profile_key) BETWEEN 1 AND 120),
  CHECK (length(character_name) BETWEEN 1 AND 120),
  CHECK (grunt_group IS NULL OR length(grunt_group) <= 80)
);

CREATE TABLE IF NOT EXISTS dmo_character_grunt_match_overrides (
  submission_id BIGINT REFERENCES dmo_submissions(id) ON DELETE CASCADE,
  broadcast_id UUID REFERENCES dmo_live_broadcasts(id) ON DELETE CASCADE,
  player_index SMALLINT NOT NULL CHECK (player_index IN (0, 1)),
  grunt_group TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((submission_id IS NOT NULL) <> (broadcast_id IS NOT NULL)),
  CHECK (grunt_group IS NULL OR length(grunt_group) <= 80)
);

CREATE UNIQUE INDEX IF NOT EXISTS dmo_character_grunt_match_submission_idx
  ON dmo_character_grunt_match_overrides (submission_id, player_index)
  WHERE submission_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dmo_character_grunt_match_broadcast_idx
  ON dmo_character_grunt_match_overrides (broadcast_id, player_index)
  WHERE broadcast_id IS NOT NULL;
