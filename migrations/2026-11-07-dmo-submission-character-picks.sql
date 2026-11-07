ALTER TABLE dmo_submissions
  ADD COLUMN IF NOT EXISTS player1_character TEXT,
  ADD COLUMN IF NOT EXISTS player2_character TEXT;
