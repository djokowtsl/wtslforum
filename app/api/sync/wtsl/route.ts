import { NextRequest, NextResponse } from 'next/server';
import { syncTournamentsAllTours, syncPlayersAllTours } from '@/lib/tournaments';
import { inspectWTSLRankings } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Sync failed');

export async function GET(req: NextRequest) {
  const external = req.headers.get('x-wtsl-sync-secret');
  const cron = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const bearer = cronSecret ? ('Bearer ' + cronSecret) : null;
  const authorized = (process.env.WTSL_SYNC_SECRET && external === process.env.WTSL_SYNC_SECRET) || (!!bearer && cron === bearer);
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ?debug=1 -> show what the rankings page returned and how it was parsed (writes nothing).
  if (req.nextUrl.searchParams.get('debug')) {
    try { return NextResponse.json(await inspectWTSLRankings()); } catch (e) { return NextResponse.json({ error: msg(e) }, { status: 500 }); }
  }

  // Players first, so tournament champions already exist when tournaments are synced.
  // Syncs every WTSL tour: ATP, WTA, Competitive Doubles, Coop and Created Characters.
  const result: Record<string, unknown> = { ok: true };
  let failures = 0;
  try { result.players = await syncPlayersAllTours(); } catch (e) { failures++; result.players = { error: msg(e) }; }
  try { result.tournaments = await syncTournamentsAllTours(); } catch (e) { failures++; result.tournaments = { error: msg(e) }; }
  if (failures === 2) result.ok = false;
  return NextResponse.json(result, { status: failures === 2 ? 500 : 200 });
}