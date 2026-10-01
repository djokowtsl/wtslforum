import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { syncTournamentsAllTours, syncPlayersAllTours } from '@/lib/tournaments';
import { syncPlayerStatsAllTours } from '@/lib/playerStats';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Sync failed');

// Lets an admin force a full sync from the site itself, instead of waiting on the
// hourly/daily Vercel crons (useful right after a deploy, or if a cron run was missed).
export async function POST() {
  const u = await getSession();
  if (!u?.isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result: Record<string, unknown> = { ok: true };
  let failures = 0;
  try { result.players = await syncPlayersAllTours(); } catch (e) { failures++; result.players = { error: msg(e) }; }
  try { result.tournaments = await syncTournamentsAllTours(); } catch (e) { failures++; result.tournaments = { error: msg(e) }; }
  try { result.playerStats = await syncPlayerStatsAllTours(); } catch (e) { failures++; result.playerStats = { error: msg(e) }; }
  if (failures === 3) result.ok = false;
  return NextResponse.json(result, { status: failures === 3 ? 500 : 200 });
}
