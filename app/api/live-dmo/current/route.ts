import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { hasCompletedDmoPoints } from '@/lib/te4DmoLive';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to watch live broadcasts.' }, { status: 401, headers: PRIVATE_HEADERS });
  }
  try {
    const rows = await sql`
      WITH expired_rows AS (
        DELETE FROM dmo_live_broadcasts
        WHERE expires_at <= NOW()
        RETURNING id
      )
      SELECT b.id, b.owner_discord_id, b.status, b.payload, b.sequence,
        b.started_at, b.updated_at, u.display_name AS owner_name,
        (b.status='live' AND b.updated_at < NOW() - INTERVAL '10 seconds') AS stale
      FROM dmo_live_broadcasts b
      LEFT JOIN users u ON u.discord_id=b.owner_discord_id
      WHERE (b.status='live' AND b.expires_at > NOW())
        OR (b.status='ended' AND b.expires_at > NOW())
      ORDER BY (b.status='live') DESC, b.started_at DESC
      LIMIT 50
    `;
    const broadcasts = rows.flatMap((row: any) => {
      const stored = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? row.payload as Record<string, any>
        : {};
      // Preserve reads from older single-snapshot rows created before the payload envelope.
      const legacySnapshot = stored.version === 1 ? stored : null;
      const snapshot = stored.snapshot && typeof stored.snapshot === 'object' ? stored.snapshot : legacySnapshot;
      const hasDmo = stored.hasDmo === true
        || stored.mode === 'auto'
        || stored.replay === true
        || legacySnapshot !== null
        || Boolean(stored.snapshot);
      // The host fully parses and validates historical replay files before
      // starting them, so their opening snapshot can legitimately have 0 points.
      const validatedReplayOpening = stored.mode === 'manual'
        && stored.replay === true
        && snapshot?.version === 1
        && Number.isInteger(snapshot.frameCount)
        && snapshot.frameCount >= 10
        && snapshot.pointCount === 0
        && Array.isArray(snapshot.players)
        && snapshot.players.length === 2
        && Array.isArray(snapshot.court);
      if (hasDmo && !hasCompletedDmoPoints(snapshot) && !validatedReplayOpening) return [];
      const rawPlayers = Array.isArray(stored.players) && stored.players.length === 2
        ? stored.players
        : Array.isArray(snapshot?.players) && snapshot.players.length === 2
          ? snapshot.players
          : null;
      const stream = stored.stream && typeof stored.stream === 'object'
        && ['youtube', 'twitch', 'twitch-clip'].includes(stored.stream.provider)
        && typeof stored.stream.id === 'string'
        && /^[A-Za-z0-9_-]{3,64}$/.test(stored.stream.id)
        && typeof stored.stream.sourceUrl === 'string'
        ? stored.stream
        : null;
      return [{
        id: row.id,
        status: row.status,
        ownerName: row.owner_name || 'Forum member',
        snapshot,
        stream,
        sourceMessageUrl: typeof stored.sourceMessageUrl === 'string' ? stored.sourceMessageUrl : null,
        broadcastMode: stored.mode === 'auto' ? 'auto' : 'manual',
        replay: stored.replay === true,
        replaySpeed: [1, 2, 4].includes(Number(stored.replaySpeed))
          ? Number(stored.replaySpeed)
          : 1,
        officialByBroadcaster: stored.officialByBroadcaster === true,
        likelyOfficial: stored.likelyOfficial === true,
        players: rawPlayers,
        sequence: Number(row.sequence || 0),
        startedAt: new Date(row.started_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        stale: Boolean(row.stale),
      }];
    });
    return NextResponse.json({
      broadcasts,
      broadcast: broadcasts[0] ?? null,
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[live-broadcast] viewer read failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { error: 'Live broadcasts are temporarily unavailable.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
