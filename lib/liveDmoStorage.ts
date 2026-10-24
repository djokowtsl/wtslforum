import { del } from '@vercel/blob';
import { sql } from '@/lib/db';
import { finishLiveBroadcastAnnouncement } from '@/lib/liveBroadcastAnnouncements';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const LIVE_REPLAY_PATH = new RegExp(`^dmo-live-replays/${UUID}-${UUID}\\.json$`, 'i');

export function isLiveDmoReplayPath(value: unknown): value is string {
  return typeof value === 'string' && LIVE_REPLAY_PATH.test(value);
}

export async function cleanupExpiredLiveDmoBroadcasts() {
  const expired = await sql`
    SELECT id, owner_discord_id, status, payload,
      payload->>'replayDataPath' AS replay_path
    FROM dmo_live_broadcasts
    WHERE expires_at <= NOW()
  `;
  const storeId = process.env.MODERATION_BLOB_STORE_ID;

  for (const row of expired) {
    if (row.status === 'live') {
      const ended = await sql`
        UPDATE dmo_live_broadcasts
        SET status='ended',
            updated_at=NOW(),
            expires_at=NOW() + INTERVAL '15 minutes'
        WHERE id=${row.id}::uuid
          AND status='live'
          AND expires_at <= NOW()
        RETURNING id, owner_discord_id, payload
      `;
      if (ended.length) {
        await finishLiveBroadcastAnnouncement({
          id: String(ended[0].id),
          ownerDiscordId: String(ended[0].owner_discord_id),
          payload: ended[0].payload,
        });
      }
      continue;
    }

    if (isLiveDmoReplayPath(row.replay_path)) {
      if (!storeId) continue;
      try {
        await del(row.replay_path, { storeId });
      } catch (error) {
        console.error('[live-broadcast] expired replay cleanup failed', error instanceof Error ? error.name : 'UnknownError');
        continue;
      }
    }
    await sql`
      DELETE FROM dmo_live_broadcasts
      WHERE id=${row.id}::uuid AND expires_at <= NOW()
    `;
  }
}
