import { after, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { hasCompletedDmoPoints } from '@/lib/te4DmoLive';
import { cleanupExpiredLiveDmoBroadcasts, isLiveDmoReplayPath } from '@/lib/liveDmoStorage';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const viewerHeartbeatSchema = z.object({ broadcastId: z.string().uuid() }).strict();
const MAX_HEARTBEAT_BYTES = 512;
let lastCleanupScheduledAt = 0;

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET() {
  const startedAt = performance.now();
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to watch live broadcasts.' }, { status: 401, headers: PRIVATE_HEADERS });
  }
  try {
    // Never delay frame delivery for Discord announcement edits or Blob deletes.
    // Next keeps this work alive after sending the response. Coalesce per instance.
    if (Date.now() - lastCleanupScheduledAt >= 15_000) {
      lastCleanupScheduledAt = Date.now();
      after(async () => {
        try {
          await cleanupExpiredLiveDmoBroadcasts();
        } catch (error) {
          lastCleanupScheduledAt = 0;
          console.error('[live-broadcast] background cleanup failed', error instanceof Error ? error.name : 'UnknownError');
        }
      });
    }
    const rows = await sql`
      SELECT b.id, b.owner_discord_id, b.status, b.payload, b.sequence,
        b.started_at, b.updated_at, u.display_name AS owner_name,
        (b.status='live' AND b.updated_at < NOW() - INTERVAL '3 seconds') AS stale
      FROM dmo_live_broadcasts b
      LEFT JOIN users u ON u.discord_id=b.owner_discord_id
      WHERE b.expires_at > NOW()
        AND (b.status='live'
          OR (b.status='ended' AND b.updated_at >= NOW() - INTERVAL '60 seconds'))
      ORDER BY (b.status='live') DESC, b.started_at DESC
      LIMIT 50
    `;
    const orderedRows = [...rows].sort((first: any, second: any) =>
      Number(second.status === 'live') - Number(first.status === 'live')
      || Date.parse(second.started_at) - Date.parse(first.started_at)
      || Date.parse(second.updated_at) - Date.parse(first.updated_at),
    );
    const broadcasts = orderedRows.flatMap((row: any) => {
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
        canManageTour: user.isAdmin || String(row.owner_discord_id) === user.discordId,
        ...(typeof stored.character === 'string' && stored.character.trim().length <= 120
          ? { character: stored.character.trim() }
          : {}),
        snapshot,
        stream,
        sourceMessageUrl: typeof stored.sourceMessageUrl === 'string' ? stored.sourceMessageUrl : null,
        broadcastMode: stored.mode === 'auto' ? 'auto' : 'manual',
        tournamentRound: typeof stored.tournamentRound === 'string'
          && ['auto', 'round-of-64', 'round-of-32', 'round-of-16', 'quarterfinal', 'semifinal', 'final']
            .some((round) => round === stored.tournamentRound)
          ? stored.tournamentRound
          : 'auto',
        isWta: stored.isWta === true,
        officialByBroadcaster: stored.officialByBroadcaster === true,
        officialByTournament: stored.officialByTournament === true,
        likelyOfficial: stored.likelyOfficial === true,
        replay: stored.replay === true,
        replayDataReady: isLiveDmoReplayPath(stored.replayDataPath),
        replaySpeed: [1, 2, 4].includes(Number(stored.replaySpeed))
          ? Number(stored.replaySpeed)
          : 1,
        players: rawPlayers,
        sequence: Number(row.sequence || 0),
        startedAt: new Date(row.started_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        stale: Boolean(row.stale),
      }];
    });
    const durationMs = Math.round(performance.now() - startedAt);
    if (durationMs > 1_200) {
      console.warn('[live-broadcast] slow snapshot read', { durationMs, broadcasts: broadcasts.length });
    }
    return NextResponse.json({
      broadcasts,
      broadcast: broadcasts[0] ?? null,
      transport: { servedAt: new Date().toISOString(), readDurationMs: durationMs },
    }, { headers: { ...PRIVATE_HEADERS, 'Server-Timing': `snapshot;dur=${durationMs}` } });
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
