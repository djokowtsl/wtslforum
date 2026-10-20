CREATE TABLE IF NOT EXISTS dmo_live_broadcasts (
  id UUID PRIMARY KEY,
  owner_discord_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('live', 'ended')),
  sequence BIGINT NOT NULL DEFAULT 0 CHECK (sequence >= 0),
  payload JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS dmo_live_broadcasts_expiry_idx
  ON dmo_live_broadcasts (expires_at);

CREATE INDEX IF NOT EXISTS dmo_live_broadcasts_active_idx
  ON dmo_live_broadcasts (started_at DESC)
  WHERE status = 'live';
