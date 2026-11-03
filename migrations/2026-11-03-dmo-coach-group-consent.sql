ALTER TABLE dmo_submissions
  ADD COLUMN IF NOT EXISTS coach_group_share_consent BOOLEAN NOT NULL DEFAULT FALSE;
