import { NextRequest, NextResponse } from 'next/server';
import { profileScreenshotStats } from '@/lib/botRatingLeaderboards';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id: rawId } = await params;
  const playerId = rawId.trim();
  const tour = request.nextUrl.searchParams.get('tour');

  if (!playerId || playerId.length > 64) {
    return NextResponse.json({ ok: false, error: 'A valid WTSL player ID is required.' }, { status: 400 });
  }
  if (tour !== 'TE4' && tour !== 'TE4_(F)') {
    return NextResponse.json({ ok: false, error: 'Screenshot stats are only available for ATP and WTA singles.' }, { status: 400 });
  }

  try {
    const stats = await profileScreenshotStats(playerId, tour);
    return NextResponse.json({ ok: true, stats }, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Ambiguous screenshot statistics identity') {
      return NextResponse.json({ ok: true, stats: null }, {
        headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
      });
    }
    console.warn('[live-player-stats] screenshot lookup failed', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ ok: false, error: 'Screenshot stats are temporarily unavailable.' }, { status: 503 });
  }
}
