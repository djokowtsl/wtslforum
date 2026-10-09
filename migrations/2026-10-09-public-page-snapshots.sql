CREATE TABLE IF NOT EXISTS forum_public_page_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL,
  stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS forum_public_page_snapshots_checked_idx
  ON forum_public_page_snapshots (checked_at DESC);
