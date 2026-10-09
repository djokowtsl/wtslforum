import { NextResponse } from 'next/server';
import { recentWtslSiteMatches } from '@/lib/stats';
import { DEFAULT_TOUR, isTourCode } from '@/lib/wtsl';
import { safe } from '@/lib/db';
import { getTournaments } from '@/lib/tournaments';
import { buildWtslTournamentNameLookup } from '@/lib/wtslResultDisplay';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const noStore = { 'cache-control': 'no-store, max-age=0' };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tour = url.searchParams.get('tour') || DEFAULT_TOUR;
  const requestedLimit = Number(url.searchParams.get('limit') || 20);

  if (!isTourCode(tour)) {
    return NextResponse.json({ error: 'invalid_tour' }, { status: 400, headers: noStore });
  }
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    return NextResponse.json({ error: 'invalid_limit' }, { status: 400, headers: noStore });
  }

  try {
    const [results, tournaments] = await Promise.all([
      recentWtslSiteMatches(Math.min(requestedLimit, 60), tour),
      safe(() => getTournaments(tour), [] as any[]),
    ]);
    return NextResponse.json(
      { results, tournamentNames: buildWtslTournamentNameLookup(tournaments) },
      { headers: noStore },
    );
  } catch (error) {
    console.error('[live-results] Feed unavailable', {
      tour,
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'live_results_unavailable' },
      { status: 503, headers: noStore },
    );
  }
}
