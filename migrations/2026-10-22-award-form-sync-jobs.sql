CREATE TABLE IF NOT EXISTS award_form_sync_jobs (
  id BIGSERIAL PRIMARY KEY,
  cycle_id BIGINT NOT NULL REFERENCES award_cycles(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  desired_fingerprint CHAR(64) NOT NULL,
  desired_updated_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'waiting_required', 'synced', 'retryable', 'needs_review')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ,
  last_error_code TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, voter_key)
);

CREATE INDEX IF NOT EXISTS award_form_sync_jobs_cycle_status_idx
  ON award_form_sync_jobs (cycle_id, status, updated_at DESC);
