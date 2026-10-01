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
  try { result.players = await syncPlayersAllTours(); } catch (e) { result.players = { error: msg(e) }; }
  try { result.tournaments = await syncTournamentsAllTours(); } catch (e) { result.tournaments = { error: msg(e) }; }
  try { result.playerStats = await syncPlayerStatsAllTours(); } catch (e) { result.playerStats = { error: msg(e) }; }

  // Each *AllTours() call returns one entry per tour and never throws itself — a tour-level
  // failure shows up as `{ tour, error }` inside the array, not as a rejected promise. Walk
  // every entry so a real tour error can't be reported back to the admin as a plain success.
  const anyTourError = (v: unknown) => Array.isArray(v) && v.some((x) => x && typeof x === 'object' && 'error' in x);
  const failed = ['players', 'tournaments', 'playerStats'].filter(
    (k) => (result[k] as any)?.error || anyTourError(result[k])
  );
  result.ok = failed.length === 0;
  return NextResponse.json(result, { status: failed.length ? 500 : 200 });
}
