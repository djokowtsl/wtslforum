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
  stats?: Record<string, number | null> | null;
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

function externalPlayerId(name: string): string {
  return `external:${normalizePlayerName(name) || 'unknown'}`;
}

function validPlayedAt(value?: string | null): string | null {
  if (!value) return null;
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(date)) return null;
  return Number.isNaN(Date.parse(date)) ? null : date;
}

function cleanStats(stats?: Record<string, number | null> | null) {
  return Object.fromEntries(Object.entries(stats ?? {}).filter(([, value]) =>
    typeof value === 'number' && Number.isFinite(value),
  ));
}

/**
 * Bulk-imports completed matches from an external source (the Discord bot's own results-channel
 * log, which has far deeper history than anything the public WTSL site exposes) straight into
 * `match_stats`. A row is retained when either player is on the current WTSL roster: the other
 * side gets a stable external id. This keeps historical matches in the current player's totals
 * instead of dropping them simply because an opponent is no longer on the roster.
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
  let skippedUnmatched = 0;
  const unmatched = new Set<string>();
  const skippedScores: string[] = [];
  const unmatchedRows: { player1: string; player2: string }[] = [];
  const failedRows: { player1: string; player2: string; error: string }[] = [];

  for (const r of rows) {
    const score = normalizeMatchScore(r.score);
    const sets = parseSets(score);
    if (!sets) {
      skippedNoScore++;
      if (skippedScores.length < 20) skippedScores.push(r.score);
      continue;
    }

    const matchedP1 = resolvePlayerId(r.player1, byName);
    const matchedP2 = resolvePlayerId(r.player2, byName);
    if (!matchedP1 && !matchedP2) {
      skippedUnmatched++;
      unmatched.add(r.player1);
      unmatched.add(r.player2);
      if (unmatchedRows.length < 20) unmatchedRows.push({ player1: r.player1, player2: r.player2 });
      continue;
    }

    const p1 = matchedP1 ?? externalPlayerId(r.player1);
    const p2 = matchedP2 ?? externalPlayerId(r.player2);
    if (!matchedP1) unmatched.add(r.player1);
    if (!matchedP2) unmatched.add(r.player2);

    const setsWon = sets.filter(([a, b]) => a > b).length;
    const winnerId = setsWon * 2 > sets.length ? p1 : p2;
    const pair = [p1, p2].sort();
    const playedAt = validPlayedAt(r.date);
    const sourceId = `import:${tour}:${r.tournamentName ?? 'x'}:${r.round ?? 'x'}:${pair[0]}-${pair[1]}:${playedAt ?? ''}:${score}`;
    const stats = cleanStats(r.stats);

    try {
      const result = await sql`
        INSERT INTO match_stats(source_id,tour,tournament_key,tournament_name,round_name,player_one_id,player_two_id,score,winner_id,played_at,stats)
        VALUES(${sourceId},${tour},${null},${r.tournamentName ?? null},${r.round ?? null},${p1},${p2},${score},${winnerId},${playedAt},${JSON.stringify({ player1: stats })}::jsonb)
        ON CONFLICT(source_id) DO UPDATE SET
          tournament_name=COALESCE(match_stats.tournament_name, EXCLUDED.tournament_name),
          stats=match_stats.stats || EXCLUDED.stats
        RETURNING (xmax = 0) AS inserted
      `;
      if (result[0]?.inserted) inserted++;
    } catch (error) {
      if (failedRows.length < 20) failedRows.push({
        player1: r.player1,
        player2: r.player2,
        error: error instanceof Error ? error.message : 'Database write failed',
      });
    }
  }

  let clutchUpdated: number | undefined;
  try { clutchUpdated = (await computeClutchStats(tour)).playersUpdated; } catch { /* best-effort recompute */ }

  return {
    tour,
    seen: rows.length,
    inserted,
    skippedNoScore,
    skippedUnmatched,
    skippedScores,
    unmatchedPlayers: Array.from(unmatched),
    unmatchedRows,
    failedRows,
    clutchUpdated,
  };
}
