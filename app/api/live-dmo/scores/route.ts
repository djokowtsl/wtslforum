import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getLiveBroadcastScoreFeed } from '@/lib/liveScores';
import { scoreForLiveBroadcast, type LiveBroadcastScore } from '@/lib/liveBroadcastScore';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;
let lastUnavailableWarningAt = 0;

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

// Official score retrieval is intentionally independent of court snapshots.
export async function GET() {
  const startedAt = performance.now();
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to view live scores.' }, { status: 401, headers: PRIVATE_HEADERS });
  }
  try {
    const rows = await sql`
      SELECT id, payload FROM dmo_live_broadcasts
      WHERE status='live' AND expires_at > NOW()
        AND payload->>'mode'='auto'
        AND COALESCE(payload->>'replay', 'false')<>'true'
      ORDER BY started_at DESC
      LIMIT 50
    `;
    const feed = rows.length ? await getLiveBroadcastScoreFeed() : null;
    const scores: Record<string, LiveBroadcastScore | null> = {};
    for (const row of rows) {
      const stored = row.payload ?? {};
      const snapshot = stored.snapshot ?? (stored.version === 1 ? stored : null);
      const players = snapshot?.players ?? stored.players;
      scores[row.id] = Array.isArray(players) && players.length === 2
        && players.every((name: unknown) => typeof name === 'string' && name.trim())
        ? scoreForLiveBroadcast(feed, players as [string, string], snapshot?.bestOf ?? stored.bestOf)
        : null;
    }
    const durationMs = Math.round(performance.now() - startedAt);
    const unavailableBroadcasts = Object.values(scores).filter((score) => score === null).length;
    if (unavailableBroadcasts && Date.now() - lastUnavailableWarningAt >= 15_000) {
      lastUnavailableWarningAt = Date.now();
      console.warn('[live-broadcast] official scores unmatched or unavailable', {
        feedAvailable: feed !== null,
        feedMatches: feed?.matches.length ?? 0,
        unavailableBroadcasts,
      });
    }
    if (durationMs > 1_200) {
      console.warn('[live-broadcast] slow score read', { durationMs, broadcasts: rows.length, feedAvailable: feed !== null });
    }
    return NextResponse.json({ scores, servedAt: new Date().toISOString() }, {
      headers: { ...PRIVATE_HEADERS, 'Server-Timing': `scores;dur=${durationMs}` },
    });
  } catch (error) {
    console.error('[live-broadcast] score read failed', {
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Live scores are temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
