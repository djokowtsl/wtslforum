import { NextRequest, NextResponse } from 'next/server';
import { importMatchHistory, type MatchHistoryRow } from '@/lib/matchHistoryImport';
import { isTourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Bulk match-history import, meant for the Discord bot to call instead of (or alongside) DMing
 * you the weekly results spreadsheet — it has the full results-channel history that the public
 * WTSL site's own pages only show a recent slice of. Same auth as the other sync endpoints
 * (`x-wtsl-sync-secret` header, or a `CRON_SECRET` bearer token).
 *
 * Body: { tour: "TE4" | "TE4_(F)" | ..., matches: [{ player1, player2, score, date?, tournamentName?, round? }] }
 * `score` must look like official set scores, e.g. "6-2,6-2" — rows that don't (walkovers,
 * forfeits, etc) are counted as skipped, not errors.
 */
export async function POST(req: NextRequest) {
  const external = req.headers.get('x-wtsl-sync-secret');
  const cron = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const bearer = cronSecret ? ('Bearer ' + cronSecret) : null;
  const authorized = (process.env.WTSL_SYNC_SECRET && external === process.env.WTSL_SYNC_SECRET) || (!!bearer && cron === bearer);
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const tour = body?.tour;
  const matches = body?.matches;
  if (!isTourCode(tour)) return NextResponse.json({ error: 'Invalid or missing "tour"' }, { status: 400 });
  if (!Array.isArray(matches) || !matches.length) return NextResponse.json({ error: '"matches" must be a non-empty array' }, { status: 400 });

  const statKeys = ['firstServePct', 'firstServeWonPct', 'secondServeWonPct', 'aces', 'doubleFaults', 'firstServeReturnWonPct', 'secondServeReturnWonPct', 'returnPointsWonPct', 'breakPointsWonPct', 'breakPointsSavedPct', 'tieBreaksWonPct', 'decidingSetsWonPct', 'setPointsSaved', 'matchPointsSaved'] as const;
  const rows: MatchHistoryRow[] = [];
  for (const m of matches) {
    if (!m?.player1 || !m?.player2 || !m?.score) continue;
    const stats = Object.fromEntries(statKeys.flatMap((key) => {
      const value = Number(m[key]);
      return Number.isFinite(value) ? [[key, value]] : [];
    }));
    rows.push({
      player1: String(m.player1),
      player2: String(m.player2),
      score: String(m.score),
      date: m.date ? String(m.date) : null,
      tournamentName: m.tournamentName ? String(m.tournamentName) : null,
      round: m.round ? String(m.round) : null,
      stats,
    });
  }
  if (!rows.length) return NextResponse.json({ error: 'No valid rows (each needs player1, player2, score)' }, { status: 400 });

  try {
    const result = await importMatchHistory(tour, rows);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Import failed' }, { status: 500 });
  }
}
