ALTER TABLE dmo_submissions
  ADD COLUMN IF NOT EXISTS player1_handedness TEXT
    CHECK (player1_handedness IS NULL OR player1_handedness IN ('left','right')),
  ADD COLUMN IF NOT EXISTS player2_handedness TEXT
    CHECK (player2_handedness IS NULL OR player2_handedness IN ('left','right')),
  ADD COLUMN IF NOT EXISTS player1_backhand_type TEXT
    CHECK (player1_backhand_type IS NULL OR player1_backhand_type IN ('one-handed','two-handed')),
  ADD COLUMN IF NOT EXISTS player2_backhand_type TEXT
    CHECK (player2_backhand_type IS NULL OR player2_backhand_type IN ('one-handed','two-handed')),
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hidden_by TEXT;
