CREATE TABLE IF NOT EXISTS dmo_native_motion_profiles (
  profile_key TEXT PRIMARY KEY,
  character_name TEXT NOT NULL,
  automatic_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  clips JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(clips) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS dmo_native_motion_profiles_single_fallback_idx
  ON dmo_native_motion_profiles (automatic_fallback)
  WHERE automatic_fallback;

CREATE TABLE IF NOT EXISTS dmo_native_motion_stream_overrides (
  broadcast_id UUID NOT NULL REFERENCES dmo_live_broadcasts(id) ON DELETE CASCADE,
  player_index SMALLINT NOT NULL CHECK (player_index IN (0, 1)),
  profile_key TEXT NOT NULL REFERENCES dmo_native_motion_profiles(profile_key) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (broadcast_id, player_index)
);
