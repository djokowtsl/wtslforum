CREATE TABLE dmo_replay_publication_overrides (
  submission_id BIGINT PRIMARY KEY,
  authorized_by TEXT NOT NULL CHECK (btrim(authorized_by) <> ''),
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);
