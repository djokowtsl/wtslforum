ALTER TABLE reactions
  ADD COLUMN IF NOT EXISTS article_id BIGINT REFERENCES articles(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'reactions'::regclass AND conname = 'reactions_exactly_one_target'
  ) THEN
    ALTER TABLE reactions
      ADD CONSTRAINT reactions_exactly_one_target
      CHECK (num_nonnulls(topic_id, reply_id, article_id) = 1) NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS reactions_article_user_emoji_idx
  ON reactions(user_id, article_id, emoji)
  WHERE article_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS article_comments (
  id BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'approved',
  moderation_reason TEXT,
  moderated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS article_comments_visible_idx
  ON article_comments(article_id, moderation_status, created_at DESC);
CREATE INDEX IF NOT EXISTS article_comments_pending_idx
  ON article_comments(moderation_status, created_at DESC);
