CREATE TABLE IF NOT EXISTS forum_role_requests (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_key TEXT NOT NULL CHECK (role_key IN ('tour_player', 'coach', 'doubles_player')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT '',
  UNIQUE (user_id, role_key)
);

CREATE INDEX IF NOT EXISTS forum_role_requests_status_created_idx
  ON forum_role_requests (status, requested_at, id);
