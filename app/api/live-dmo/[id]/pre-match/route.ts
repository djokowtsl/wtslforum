import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getRankedPairPreMatchProbability } from '@/lib/liveScores';

export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json(
      { error: 'Sign in to view pre-match probabilities.' },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });
  }

  try {
    const rows = await sql`
      SELECT payload
      FROM dmo_live_broadcasts
      WHERE id=${id}::uuid AND expires_at > NOW()
      LIMIT 1
    `;
    const rawPayload = rows[0]?.payload;
    const stored = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? rawPayload as Record<string, any>
      : {};
    if (!rows.length || stored.replay === true) {
      return NextResponse.json({ prediction: null }, { headers: PRIVATE_HEADERS });
    }

    const snapshot = stored.snapshot && typeof stored.snapshot === 'object'
      ? stored.snapshot as Record<string, any>
      : {};
    const rawPlayers = Array.isArray(stored.players) && stored.players.length === 2
      ? stored.players
      : Array.isArray(snapshot.players) && snapshot.players.length === 2
        ? snapshot.players
        : null;
    const players = rawPlayers?.every((name: unknown) => typeof name === 'string' && name.trim())
      ? rawPlayers as [string, string]
      : null;
    const rawBestOf = stored.bestOf ?? snapshot.bestOf;
    const bestOf = rawBestOf === 1 || rawBestOf === 3 || rawBestOf === 5 ? rawBestOf : null;
    if (!players || !bestOf) {
      return NextResponse.json({ prediction: null }, { headers: PRIVATE_HEADERS });
    }

    const prediction = await getRankedPairPreMatchProbability(players, bestOf);
    return NextResponse.json({ prediction }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[live-broadcast] pre-match probability lookup failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { error: 'The pre-match estimate is temporarily unavailable.' },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
