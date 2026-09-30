import { NextRequest, NextResponse } from 'next/server';
import { syncTournaments, syncPlayers } from '@/lib/tournaments';
import { inspectWTSLRankings } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Sync failed');

export async function GET(req: NextRequest) {
  const external = req.headers.get('x-wtsl-sync-secret');
  const cron = req.headers.get('authorization');
  const authorized = (process.env.WTSL_SYNC_SECRET && external === process.env.WTSL_SYNC_SECRET) || (process.env.CRON_SECRET && cron === `Bearer ${process.env.CRON_SECRET}`);
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ?debug=1 → show what the rankings page returned and how it was parsed (writes nothing).
  if (req.nextUrl.searchParams.get('debug')) {
    try { return NextResponse.json(await inspectWTSLRankings()); } catch (e) { return NextResponse.json({ error: msg(e) }, { status: 500 }); }
  }

  // Players first, so tournament champions already exist when tournaments are synced.
  const result: Record<string, unknown> = { ok: true };
  let failures = 0;
  try { result.players = await syncPlayers(); } catch (e) { failures++; result.players = { error: msg(e) }; }
  try { result.tournaments = await syncTournaments(); } catch (e) { failures++; result.tournaments = { error: msg(e) }; }
  if (failures === 2) result.ok = false;
  return NextResponse.json(result, { status: failures === 2 ? 500 : 200 });
}
