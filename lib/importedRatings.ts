import { sql } from './db';

export type ImportedRating = {
  player: string;
  playerId: string;
  /** Total imported matches — the same denominator used by Player Statistics. */
  matches: number;
  value: number;
};

type RatingSourceRow = {
  player: string;
  playerId: string;
  matches: number;
  firstServePct: number | null;
  firstServeWonPct: number | null;
  secondServeWonPct: number | null;
  aces: number | null;
  doubleFaults: number | null;
  firstServeReturnWonPct: number | null;
  secondServeReturnWonPct: number | null;
  breakPointsWonPct: number | null;
  breakPointsSavedPct: number | null;
  tieBreaksWonPct: number | null;
  decidingSetsWonPct: number | null;
};

/**
 * Uses the Discord bot's component sums, aggregated from both sides of every imported
 * match. A missing historical component contributes no value rather than dropping an
 * otherwise eligible player from the table.
 */
export async function importedMatchRatings(tour: string, metric: 'serve' | 'return' | 'pressure'): Promise<ImportedRating[]> {
  const rows = await sql`
    WITH sides AS (
      SELECT player_one_id AS player_id, stats->'player1' AS stat_line
      FROM match_stats
      WHERE tour=${tour}
      UNION ALL
      SELECT player_two_id AS player_id, stats->'player2' AS stat_line
      FROM match_stats
      WHERE tour=${tour}
    ), aggregated AS (
      SELECT
        player_id,
        COUNT(*)::int AS matches,
        AVG((stat_line->>'firstServePct')::numeric)::float AS first_serve_pct,
        AVG((stat_line->>'firstServeWonPct')::numeric)::float AS first_serve_won_pct,
        AVG((stat_line->>'secondServeWonPct')::numeric)::float AS second_serve_won_pct,
        AVG((stat_line->>'aces')::numeric)::float AS aces,
        AVG((stat_line->>'doubleFaults')::numeric)::float AS double_faults,
        AVG((stat_line->>'firstServeReturnWonPct')::numeric)::float AS first_serve_return_won_pct,
        AVG((stat_line->>'secondServeReturnWonPct')::numeric)::float AS second_serve_return_won_pct,
        AVG((stat_line->>'breakPointsWonPct')::numeric)::float AS break_points_won_pct,
        AVG((stat_line->>'breakPointsSavedPct')::numeric)::float AS break_points_saved_pct,
        AVG((stat_line->>'tieBreaksWonPct')::numeric)::float AS tie_breaks_won_pct,
        AVG((stat_line->>'decidingSetsWonPct')::numeric)::float AS deciding_sets_won_pct
      FROM sides
      GROUP BY player_id
    )
    SELECT
      p.name AS player,
      p.wtsl_player_id AS "playerId",
      a.matches,
      a.first_serve_pct AS "firstServePct",
      a.first_serve_won_pct AS "firstServeWonPct",
      a.second_serve_won_pct AS "secondServeWonPct",
      a.aces,
      a.double_faults AS "doubleFaults",
      a.first_serve_return_won_pct AS "firstServeReturnWonPct",
      a.second_serve_return_won_pct AS "secondServeReturnWonPct",
      a.break_points_won_pct AS "breakPointsWonPct",
      a.break_points_saved_pct AS "breakPointsSavedPct",
      a.tie_breaks_won_pct AS "tieBreaksWonPct",
      a.deciding_sets_won_pct AS "decidingSetsWonPct"
    FROM aggregated a
    JOIN wtsl_players p ON p.wtsl_player_id = a.player_id AND p.tour=${tour}
  ` as RatingSourceRow[];

  const value = (row: RatingSourceRow) => metric === 'serve'
    ? ((row.firstServePct ?? 0) + (row.firstServeWonPct ?? 0) + (row.secondServeWonPct ?? 0)) * 100 + (row.aces ?? 0) - (row.doubleFaults ?? 0)
    : metric === 'return'
      ? ((row.firstServeReturnWonPct ?? 0) + (row.secondServeReturnWonPct ?? 0) + (row.breakPointsWonPct ?? 0)) * 100
      : ((row.breakPointsWonPct ?? 0) + (row.breakPointsSavedPct ?? 0) + (row.tieBreaksWonPct ?? 0) + (row.decidingSetsWonPct ?? 0)) * 100;

  return rows
    .map((row) => ({ player: row.player, playerId: row.playerId, matches: row.matches, value: value(row) }))
    .sort((a, b) => b.value - a.value || a.player.localeCompare(b.player));
}
