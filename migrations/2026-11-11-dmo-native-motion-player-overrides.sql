CREATE TABLE IF NOT EXISTS dmo_native_motion_player_overrides (
  submission_id BIGINT REFERENCES dmo_submissions(id) ON DELETE CASCADE,
  broadcast_id UUID REFERENCES dmo_live_broadcasts(id) ON DELETE CASCADE,
  player_index SMALLINT NOT NULL CHECK (player_index IN (0, 1)),
  clips JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((submission_id IS NOT NULL) <> (broadcast_id IS NOT NULL)),
  CHECK (jsonb_typeof(clips) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS dmo_native_motion_player_overrides_submission_idx
  ON dmo_native_motion_player_overrides (submission_id, player_index)
  WHERE submission_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dmo_native_motion_player_overrides_broadcast_idx
  ON dmo_native_motion_player_overrides (broadcast_id, player_index)
  WHERE broadcast_id IS NOT NULL;
