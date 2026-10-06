ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS discussion_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Live tournament rows from 2026 onward had discussions created by the current-season sync.
-- Earlier rows were intentionally imported without discussions, so do not enable all history.
UPDATE public.tournaments
SET discussion_enabled = TRUE
WHERE discussion_enabled = FALSE
  AND (discussion_topic_id IS NOT NULL OR start_date >= DATE '2026-01-01');