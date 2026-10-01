import { sql } from './db';
import { parseSets, computeClutchStats } from './playerStats';
import { normalizePlayerName } from './queries';
import { type TourCode } from './wtsl';

export type MatchHistoryRow = {
  player1: string;
  player2: string;
  score: string;
  date?: string | null;
  tournamentName?: string | null;
  round?: string | null;
};

/**
 * Bulk-imports completed matches from an external source (the Discord bot's own results-channel
 * log, which has far deeper history than anything the public WTSL site exposes) straight into
 * `match_stats`. Player names are matched against `wtsl_players` with the same emoji/"aka"-
 * stripping used for awards, since the bot's log uses plain display names, not WTSL player ids.
 * Safe to re-run with overlapping data — `source_id` is deterministic per match, so uploading the
 * same week's export twice (or a growing weekly export) only ever inserts the genuinely new rows.
 */
export async function importMatchHistory(tour: TourCode, rows: MatchHistoryRow[]) {
  const players = await sql`SELECT wtsl_player_id, name FROM wtsl_players WHERE tour=${tour}`;
  const byName = new Map<string, string>();
  for (const p of players as any[]) {
    const key = normalizePlayerName(p.name);
    if (key) byName.set(key, String(p.wtsl_player_id));
  }

  let inserted = 0;
  let skippedNoScore = 0;
  const unmatched = new Set<string>();

  for (const r of rows) {
    const sets = parseSets(r.score);
    if (!sets) { skippedNoScore++; continue; }
    const p1 = byName.get(normalizePlayerName(r.player1));
    const p2 = byName.get(normalizePlayerName(r.player2));
    if (!p1 || !p2) {
      if (!p1) unmatched.add(r.player1);
      if (!p2) unmatched.add(r.player2);
      continue;
    }
    const setsWon = sets.filter(([a, b]) => a > b).length;
    const winnerId = setsWon * 2 > sets.length ? p1 : p2;
    const pair = [p1, p2].sort();
    const sourceId = `import:${tour}:${r.tournamentName ?? 'x'}:${r.round ?? 'x'}:${pair[0]}-${pair[1]}:${r.date ?? ''}:${r.score}`;

    const result = await sql`
      INSERT INTO match_stats(source_id,tour,tournament_key,tournament_name,round_name,player_one_id,player_two_id,score,winner_id,played_at)
      VALUES(${sourceId},${tour},${null},${r.tournamentName ?? null},${r.round ?? null},${p1},${p2},${r.score},${winnerId},${r.date ?? null})
      ON CONFLICT(source_id) DO UPDATE SET tournament_name=COALESCE(match_stats.tournament_name, EXCLUDED.tournament_name)
      RETURNING (xmax = 0) AS inserted
    `;
    if (result[0]?.inserted) inserted++;
  }

  let clutchUpdated: number | undefined;
  try { clutchUpdated = (await computeClutchStats(tour)).playersUpdated; } catch { /* best-effort recompute */ }

  return { tour, seen: rows.length, inserted, skippedNoScore, unmatchedPlayers: Array.from(unmatched), clutchUpdated };
}
