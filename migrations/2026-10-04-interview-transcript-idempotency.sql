ALTER TABLE topics ADD COLUMN IF NOT EXISTS source_key TEXT;
ALTER TABLE replies ADD COLUMN IF NOT EXISTS source_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS topics_source_key_key ON topics(source_key);
CREATE UNIQUE INDEX IF NOT EXISTS replies_source_key_key ON replies(source_key);