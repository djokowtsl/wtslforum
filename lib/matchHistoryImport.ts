import { sql } from './db';
import { parseSets, computeClutchStats, normalizeMatchScore } from './playerStats';
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
 * Resolves one side's name to a `wtsl_players` id. In Competitive Doubles (TE4_CD) the bot's
 * workbook stores each side as "RankedPlayer & CPU Partner" (every doubles match is actually
 * ranked-player-plus-CPU, not two humans) — the CPU partner is never in `wtsl_players`, so when
 * a direct name match fails, each "&"-separated part is tried in turn and whichever one resolves
 * is used. This is a no-op for singles tours, where names essentially never contain "&".
 */
function resolvePlayerId(name: string, byName: Map<string, string>): string | undefined {
  const direct = byName.get(normalizePlayerName(name));
  if (direct) return direct;
  const parts = name.split(/\s*&\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return undefined;
  for (const part of parts) {
    const id = byName.get(normalizePlayerName(part));
    if (id) return id;
  }
  return undefined;
}

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
  const skippedScores: string[] = [];
  const unmatchedRows: { player1: string; player2: string }[] = [];

  for (const r of rows) {
    const score = normalizeMatchScore(r.score);
    const sets = parseSets(score);
    if (!sets) {
      skippedNoScore++;
      if (skippedScores.length < 20) skippedScores.push(r.score);
      continue;
    }
    const p1 = resolvePlayerId(r.player1, byName);
    const p2 = resolvePlayerId(r.player2, byName);
    if (!p1 || !p2) {
      if (!p1) unmatched.add(r.player1);
      if (!p2) unmatched.add(r.player2);
      if (unmatchedRows.length < 20) unmatchedRows.push({ player1: r.player1, player2: r.player2 });
      continue;
    }
    const setsWon = sets.filter(([a, b]) => a > b).length;
    const winnerId = setsWon * 2 > sets.length ? p1 : p2;
    const pair = [p1, p2].sort();
    const sourceId = `import:${tour}:${r.tournamentName ?? 'x'}:${r.round ?? 'x'}:${pair[0]}-${pair[1]}:${r.date ?? ''}:${score}`;

    const result = await sql`
      INSERT INTO match_stats(source_id,tour,tournament_key,tournament_name,round_name,player_one_id,player_two_id,score,winner_id,played_at)
      VALUES(${sourceId},${tour},${null},${r.tournamentName ?? null},${r.round ?? null},${p1},${p2},${score},${winnerId},${r.date ?? null})
      ON CONFLICT(source_id) DO UPDATE SET tournament_name=COALESCE(match_stats.tournament_name, EXCLUDED.tournament_name)
      RETURNING (xmax = 0) AS inserted
    `;
    if (result[0]?.inserted) inserted++;
  }

  let clutchUpdated: number | undefined;
  try { clutchUpdated = (await computeClutchStats(tour)).playersUpdated; } catch { /* best-effort recompute */ }

  return { tour, seen: rows.length, inserted, skippedNoScore, skippedScores, unmatchedPlayers: Array.from(unmatched), unmatchedRows, clutchUpdated };
}
