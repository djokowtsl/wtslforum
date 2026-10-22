import { del } from '@vercel/blob';
import { sql } from '@/lib/db';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const LIVE_REPLAY_PATH = new RegExp(`^dmo-live-replays/${UUID}-${UUID}\\.json$`, 'i');

export function isLiveDmoReplayPath(value: unknown): value is string {
  return typeof value === 'string' && LIVE_REPLAY_PATH.test(value);
}

export async function cleanupExpiredLiveDmoBroadcasts() {
  const expired = await sql`
    SELECT id, payload->>'replayDataPath' AS replay_path
    FROM dmo_live_broadcasts
    WHERE expires_at <= NOW()
  `;
  const storeId = process.env.MODERATION_BLOB_STORE_ID;

  for (const row of expired) {
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
