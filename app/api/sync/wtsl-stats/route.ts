import { NextRequest, NextResponse } from 'next/server';
import { syncPlayerStats, syncPlayerStatsAllTours } from '@/lib/playerStats';
import { isTourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
// Scraping every player's profile page is far heavier than the rankings/tournaments sync (one
// request per player, per tour), so this runs on its own, less frequent schedule.
export const maxDuration = 300;

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Sync failed');

export async function GET(req: NextRequest) {
  const external = req.headers.get('x-wtsl-sync-secret');
  const cron = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const bearer = cronSecret ? ('Bearer ' + cronSecret) : null;
  const authorized = (process.env.WTSL_SYNC_SECRET && external === process.env.WTSL_SYNC_SECRET) || (!!bearer && cron === bearer);
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ?tour=TE4 -> sync a single tour (useful to stay under a serverless function time limit).
  const tourParam = req.nextUrl.searchParams.get('tour');
  try {
    if (isTourCode(tourParam)) return NextResponse.json({ ok: true, result: await syncPlayerStats(tourParam) });
    return NextResponse.json({ ok: true, result: await syncPlayerStatsAllTours() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: msg(e) }, { status: 500 });
  }
}
