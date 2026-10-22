ALTER TABLE award_cycles
  ADD COLUMN IF NOT EXISTS voting_closes_at TIMESTAMPTZ;
