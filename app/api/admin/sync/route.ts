import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { syncTournaments, syncPlayers, TOURS } from '@/lib/tournaments';
import { syncPlayerStats } from '@/lib/playerStats';
import type { TourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Sync failed');
const VALID_TOURS = new Set(TOURS.map((t) => t.code));

// Runs exactly one (category, tour) job per request instead of all 5 tours x 3 categories in
// one call. Scraping every player's profile page for every tour in a single serverless
// invocation easily runs past Vercel's function time limit, which kills the function mid-sync
// and leaves the admin with a generic "check your connection" error and half-synced data. The
// admin UI now makes 15 small requests in sequence so each one finishes comfortably in time and
// a slow/failing tour can't block the others.
export async function POST(req: Request) {
  const u = await getSession();
  if (!u?.isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const category = body?.category as string | undefined;
  const tour = body?.tour as string | undefined;
  if (!tour || !VALID_TOURS.has(tour as TourCode)) {
    return NextResponse.json({ error: 'Unknown tour' }, { status: 400 });
  }

  try {
    let result: unknown;
    if (category === 'players') result = await syncPlayers(tour as TourCode);
    else if (category === 'tournaments') result = await syncTournaments(tour as TourCode);
    else if (category === 'playerStats') result = await syncPlayerStats(tour as TourCode);
    else return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ ok: false, result: { tour, error: msg(e) } }, { status: 200 });
  }
}
