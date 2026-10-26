ALTER TABLE replies
  ADD COLUMN IF NOT EXISTS parent_reply_id BIGINT;

ALTER TABLE replies
  DROP CONSTRAINT IF EXISTS replies_parent_reply_id_fkey;

ALTER TABLE replies
  ADD CONSTRAINT replies_parent_reply_id_fkey
  FOREIGN KEY (parent_reply_id) REFERENCES replies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS replies_parent_reply_id_idx
  ON replies(parent_reply_id, moderation_status, created_at);

ALTER TABLE article_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id BIGINT;

ALTER TABLE article_comments
  DROP CONSTRAINT IF EXISTS article_comments_parent_comment_id_fkey;

ALTER TABLE article_comments
  ADD CONSTRAINT article_comments_parent_comment_id_fkey
  FOREIGN KEY (parent_comment_id) REFERENCES article_comments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS article_comments_parent_comment_id_idx
  ON article_comments(parent_comment_id, moderation_status, created_at);

CREATE TABLE IF NOT EXISTS article_comment_reactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_comment_id BIGINT NOT NULL REFERENCES article_comments(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  UNIQUE (user_id, article_comment_id, emoji)
);

CREATE INDEX IF NOT EXISTS article_comment_reactions_comment_idx
  ON article_comment_reactions(article_comment_id, emoji);
