import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { hasCompletedDmoPoints } from '@/lib/te4DmoLive';
import { cleanupExpiredLiveDmoBroadcasts, isLiveDmoReplayPath } from '@/lib/liveDmoStorage';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { getLiveBroadcastScoreFeed } from '@/lib/liveScores';
import { scoreForLiveBroadcast } from '@/lib/liveBroadcastScore';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
const viewerHeartbeatSchema = z.object({ broadcastId: z.string().uuid() }).strict();
const MAX_HEARTBEAT_BYTES = 512;

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
    await cleanupExpiredLiveDmoBroadcasts();
    const rows = await sql`
      WITH ranked_broadcasts AS (
        SELECT b.id, b.owner_discord_id, b.status, b.payload, b.sequence,
          b.started_at, b.updated_at, u.display_name AS owner_name,
          (b.status='live' AND b.updated_at < NOW() - INTERVAL '3 seconds') AS stale,
          ROW_NUMBER() OVER (
            PARTITION BY b.owner_discord_id
            ORDER BY b.started_at DESC, b.updated_at DESC, (b.status='live') DESC
          ) AS owner_rank
        FROM dmo_live_broadcasts b
        LEFT JOIN users u ON u.discord_id=b.owner_discord_id
        WHERE (b.status='live' AND b.expires_at > NOW())
          OR (b.status='ended' AND b.expires_at > NOW())
      )
      SELECT id, owner_discord_id, status, payload, sequence,
        started_at, updated_at, owner_name, stale
      FROM ranked_broadcasts
      WHERE owner_rank=1
        AND (status='live' OR updated_at >= NOW() - INTERVAL '60 seconds')
      ORDER BY (status='live') DESC, started_at DESC
      LIMIT 50
    `;
    const seenOwners = new Set<string>();
    const orderedRows = [...rows].sort((first: any, second: any) =>
      Date.parse(second.started_at) - Date.parse(first.started_at)
      || Date.parse(second.updated_at) - Date.parse(first.updated_at),
    );
    const broadcasts = orderedRows.flatMap((row: any) => {
      const ownerId = String(row.owner_discord_id ?? row.id);
      if (seenOwners.has(ownerId)) return [];
      seenOwners.add(ownerId);
      if (
        row.status === 'ended'
        && Date.now() - Date.parse(row.updated_at) > 60_000
      ) return [];

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
        replayDataReady: isLiveDmoReplayPath(stored.replayDataPath),
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
    const needsLiveScore = broadcasts.some((broadcast) =>
      broadcast.broadcastMode === 'auto' && !broadcast.replay && broadcast.status === 'live',
    );
    const scoreFeed = needsLiveScore ? await getLiveBroadcastScoreFeed() : null;
    const scoredBroadcasts = broadcasts.map((broadcast) => {
      if (broadcast.broadcastMode !== 'auto' || broadcast.replay) return broadcast;
      const players = broadcast.snapshot?.players ?? broadcast.players;
      return {
        ...broadcast,
        liveScore: broadcast.status === 'live' && players
          ? scoreForLiveBroadcast(scoreFeed, players, broadcast.snapshot?.bestOf)
          : null,
      };
    });
    return NextResponse.json({
      broadcasts: scoredBroadcasts,
      broadcast: scoredBroadcasts[0] ?? null,
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[live-broadcast] viewer read failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { error: 'Live broadcasts are temporarily unavailable.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}

export async function POST(request: Request) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to update viewer presence.' }, { status: 401, headers: PRIVATE_HEADERS });
  }
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_HEARTBEAT_BYTES) {
    return NextResponse.json({ error: 'Viewer heartbeat is too large.' }, { status: 413, headers: PRIVATE_HEADERS });
  }
  let input: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_HEARTBEAT_BYTES) {
      return NextResponse.json({ error: 'Viewer heartbeat is too large.' }, { status: 413, headers: PRIVATE_HEADERS });
    }
    input = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid viewer heartbeat.' }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const parsed = viewerHeartbeatSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid viewer heartbeat.' }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    const rows = await sql`
      WITH eligible AS (
        SELECT id FROM dmo_live_broadcasts
        WHERE id=${parsed.data.broadcastId}::uuid AND status='live' AND expires_at > NOW()
      ),
      active_viewer AS (
        INSERT INTO dmo_live_broadcast_viewers (broadcast_id, viewer_discord_id, last_seen_at)
        SELECT id, ${user.discordId}, NOW() FROM eligible
        ON CONFLICT (broadcast_id, viewer_discord_id)
        DO UPDATE SET last_seen_at=NOW()
        RETURNING broadcast_id, viewer_discord_id
      )
      SELECT COUNT(*) OVER()::int AS viewer_count,
        COALESCE(u.display_name, 'Forum member') AS display_name,
        CASE
          WHEN u.avatar_url LIKE 'https://cdn.discordapp.com/avatars/%' THEN u.avatar_url
          ELSE NULL
        END AS avatar_url
      FROM dmo_live_broadcast_viewers v
      JOIN active_viewer ON active_viewer.broadcast_id=v.broadcast_id
      LEFT JOIN users u ON u.discord_id=v.viewer_discord_id
      WHERE v.last_seen_at > NOW() - INTERVAL '45 seconds'
      ORDER BY display_name
    `;
    if (!rows.length) {
      return NextResponse.json({ error: 'This broadcast is no longer live.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({
      viewerCount: Number(rows[0].viewer_count),
      viewers: rows.map((row: any) => ({
        displayName: row.display_name || 'Forum member',
        avatarUrl: row.avatar_url || null,
      })),
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[live-broadcast] viewer heartbeat failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Viewer counts are temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
