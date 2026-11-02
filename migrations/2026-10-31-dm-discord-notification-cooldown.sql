CREATE TABLE IF NOT EXISTS forum_dm_discord_notification_cooldowns (
  recipient_user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  claim_id UUID NOT NULL,
  notified_at TIMESTAMPTZ NOT NULL
);
