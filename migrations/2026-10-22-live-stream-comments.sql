CREATE TABLE IF NOT EXISTS dmo_live_broadcast_comments (
  id BIGSERIAL PRIMARY KEY,
  broadcast_id UUID NOT NULL REFERENCES dmo_live_broadcasts(id) ON DELETE CASCADE,
  author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 500),
  moderation_status TEXT NOT NULL DEFAULT 'approved',
  moderation_reason TEXT,
  moderated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dmo_live_broadcast_comments_visible_idx
  ON dmo_live_broadcast_comments (broadcast_id, created_at DESC)
  WHERE moderation_status = 'approved';

CREATE INDEX IF NOT EXISTS dmo_live_broadcast_comments_pending_idx
  ON dmo_live_broadcast_comments (moderation_status, created_at DESC)
  WHERE moderation_status = 'pending';

CREATE INDEX IF NOT EXISTS dmo_live_broadcast_comments_author_idx
  ON dmo_live_broadcast_comments (author_id, created_at DESC);
