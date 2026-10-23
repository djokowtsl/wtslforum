CREATE TABLE IF NOT EXISTS dmo_live_broadcast_viewers (
  broadcast_id UUID NOT NULL REFERENCES dmo_live_broadcasts(id) ON DELETE CASCADE,
  viewer_discord_id TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (broadcast_id, viewer_discord_id)
);

CREATE INDEX IF NOT EXISTS dmo_live_broadcast_viewers_recent_idx
  ON dmo_live_broadcast_viewers (broadcast_id, last_seen_at DESC);
