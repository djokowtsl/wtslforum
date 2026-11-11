import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { NATIVE_MOTION_AUTOMATIC_PROFILE_KEY } from '@/lib/nativeMotionCatalogData';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

type BroadcastRow = {
  id: string;
  players: unknown;
  started_at: Date | string;
  player_index: number | null;
  profile_key: string | null;
};

export async function GET() {
  const user = await getSession();
  if (!user?.isAdmin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  try {
    const rows = await sql`
      SELECT b.id, b.payload->'players' AS players, b.started_at,
             o.player_index, o.profile_key
      FROM dmo_live_broadcasts b
      LEFT JOIN dmo_native_motion_stream_overrides o ON o.broadcast_id = b.id
      WHERE b.status = 'live' AND b.expires_at > NOW()
        AND b.payload->>'mode' = 'manual'
      ORDER BY b.started_at DESC
      LIMIT 40
    ` as BroadcastRow[];
    const broadcasts = new Map<string, {
      id: string;
      players: [string, string];
      startedAt: string;
      profileKeys: [string | null, string | null];
    }>();
    for (const row of rows) {
      let players = row.players;
      if (typeof players === 'string') {
        try { players = JSON.parse(players); } catch { players = null; }
      }
      if (!Array.isArray(players) || players.length !== 2 || !players.every((name) => typeof name === 'string')) {
        continue;
      }
      let item = broadcasts.get(row.id);
      if (!item) {
        item = {
          id: row.id,
          players: [players[0], players[1]],
          startedAt: new Date(row.started_at).toISOString(),
          profileKeys: [null, null],
        };
        broadcasts.set(row.id, item);
      }
      if (
        (row.player_index === 0 || row.player_index === 1)
        && row.profile_key
        && row.profile_key !== NATIVE_MOTION_AUTOMATIC_PROFILE_KEY
      ) {
        item.profileKeys[row.player_index] = row.profile_key;
      }
    }
    return NextResponse.json({ broadcasts: [...broadcasts.values()] }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[native-motion] broadcast list failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { error: 'Manual stream overrides are unavailable. Apply the Forum migration, then retry.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
