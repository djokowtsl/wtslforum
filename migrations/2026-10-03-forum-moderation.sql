ALTER TABLE users ADD COLUMN IF NOT EXISTS is_moderator BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE topics ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE topics ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS moderated_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;

ALTER TABLE replies ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE replies ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS moderated_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;

ALTER TABLE media_clips ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE media_clips ADD COLUMN IF NOT EXISTS moderation_reason TEXT;
ALTER TABLE media_clips ADD COLUMN IF NOT EXISTS private_blob_pathname TEXT;
ALTER TABLE media_clips ADD COLUMN IF NOT EXISTS private_blob_content_type TEXT;
ALTER TABLE media_clips ADD COLUMN IF NOT EXISTS moderated_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE media_clips ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS topics_moderation_status_idx ON topics(moderation_status,created_at);
CREATE INDEX IF NOT EXISTS replies_moderation_status_idx ON replies(moderation_status,created_at);
CREATE INDEX IF NOT EXISTS media_clips_moderation_status_idx ON media_clips(moderation_status,created_at);

CREATE TABLE IF NOT EXISTS community_notes (
  id BIGSERIAL PRIMARY KEY,
  topic_id BIGINT REFERENCES topics(id) ON DELETE CASCADE,
  reply_id BIGINT REFERENCES replies(id) ON DELETE CASCADE,
  author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'approved',
  moderation_reason TEXT,
  moderated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT community_notes_one_target CHECK ((topic_id IS NOT NULL AND reply_id IS NULL) OR (topic_id IS NULL AND reply_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS community_notes_topic_author_idx ON community_notes(topic_id,author_id) WHERE topic_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS community_notes_reply_author_idx ON community_notes(reply_id,author_id) WHERE reply_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_notes_pending_idx ON community_notes(moderation_status,created_at);

CREATE TABLE IF NOT EXISTS community_note_ratings (
  id BIGSERIAL PRIMARY KEY,
  note_id BIGINT NOT NULL REFERENCES community_notes(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helpful BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(note_id,user_id)
);