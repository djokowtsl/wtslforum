import { sql } from './db';

export type ImportedRating = {
  player: string;
  playerId: string;
  /** Total imported screenshots — the same count shown in Player Statistics. */
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
 * Match each rating to the Discord bot's `calculate_partial_overall_ratings`:
 * average each available player-side spreadsheet field, then sum only the
 * available components. A workbook row belongs to its `Player` / `player1`
 * side, so player2 is intentionally not treated as an empty duplicate.
 */
export async function importedMatchRatings(tour: string, metric: 'serve' | 'return' | 'pressure'): Promise<ImportedRating[]> {
  const rows = await sql`
    WITH verified_matches AS (
      SELECT m.*
      FROM match_stats m
      WHERE m.tour=${tour} AND (
        m.tour <> 'TE4_(F)' OR EXISTS (
          SELECT 1 FROM tournaments t
          WHERE t.tour='TE4_(F)'
            AND (
              t.wtsl_tournament_key=m.tournament_key
              OR (regexp_match(t.official_url, '[?&]tournament=([^&]+)'))[1]=m.tournament_key
            )
        )
      )
    ), total_screenshots AS (
      SELECT player_id, COUNT(*)::int AS matches
      FROM (
        SELECT player_one_id AS player_id FROM verified_matches
        UNION ALL
        SELECT player_two_id AS player_id FROM verified_matches
      ) all_sides
      GROUP BY player_id
    ), player_screenshots AS (
      SELECT
        player_one_id AS player_id,
        AVG((stats->'player1'->>'firstServePct')::numeric)::float AS first_serve_pct,
        AVG((stats->'player1'->>'firstServeWonPct')::numeric)::float AS first_serve_won_pct,
        AVG((stats->'player1'->>'secondServeWonPct')::numeric)::float AS second_serve_won_pct,
        AVG((stats->'player1'->>'aces')::numeric)::float AS aces,
        AVG((stats->'player1'->>'doubleFaults')::numeric)::float AS double_faults,
        AVG((stats->'player1'->>'firstServeReturnWonPct')::numeric)::float AS first_serve_return_won_pct,
        AVG((stats->'player1'->>'secondServeReturnWonPct')::numeric)::float AS second_serve_return_won_pct,
        AVG((stats->'player1'->>'breakPointsWonPct')::numeric)::float AS break_points_won_pct,
        AVG((stats->'player1'->>'breakPointsSavedPct')::numeric)::float AS break_points_saved_pct,
        AVG((stats->'player1'->>'tieBreaksWonPct')::numeric)::float AS tie_breaks_won_pct,
        AVG((stats->'player1'->>'decidingSetsWonPct')::numeric)::float AS deciding_sets_won_pct
      FROM verified_matches
      WHERE jsonb_typeof(stats->'player1') = 'object'
      GROUP BY player_one_id
    )
    SELECT
      p.name AS player,
      p.wtsl_player_id AS "playerId",
      totals.matches,
      stats.first_serve_pct AS "firstServePct",
      stats.first_serve_won_pct AS "firstServeWonPct",
      stats.second_serve_won_pct AS "secondServeWonPct",
      stats.aces,
      stats.double_faults AS "doubleFaults",
      stats.first_serve_return_won_pct AS "firstServeReturnWonPct",
      stats.second_serve_return_won_pct AS "secondServeReturnWonPct",
      stats.break_points_won_pct AS "breakPointsWonPct",
      stats.break_points_saved_pct AS "breakPointsSavedPct",
      stats.tie_breaks_won_pct AS "tieBreaksWonPct",
      stats.deciding_sets_won_pct AS "decidingSetsWonPct"
    FROM total_screenshots totals
    JOIN player_screenshots stats ON stats.player_id = totals.player_id
    JOIN wtsl_players p ON p.wtsl_player_id = totals.player_id AND p.tour=${tour}
  ` as RatingSourceRow[];

  const numeric = (value: number | null) => Number.isFinite(value) ? value : null;
  const percentage = (value: number | null) => {
    const number = numeric(value);
    return number === null ? null : number * 100;
  };
  const total = (...values: Array<number | null>) => {
    const available = values.filter((value): value is number => value !== null);
    return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
  };
  const rating = (row: RatingSourceRow) => metric === 'serve'
    ? total(
      percentage(row.firstServePct),
      percentage(row.firstServeWonPct),
      percentage(row.secondServeWonPct),
      numeric(row.aces),
      (() => {
        const doubleFaults = numeric(row.doubleFaults);
        return doubleFaults === null ? null : -doubleFaults;
      })(),
    )
    : metric === 'return'
      ? total(
        percentage(row.firstServeReturnWonPct),
        percentage(row.secondServeReturnWonPct),
        percentage(row.breakPointsWonPct),
      )
      : total(
        percentage(row.breakPointsWonPct),
        percentage(row.breakPointsSavedPct),
        percentage(row.tieBreaksWonPct),
        percentage(row.decidingSetsWonPct),
      );

  return rows
    .flatMap((row) => {
      const value = rating(row);
      return value === null ? [] : [{ player: row.player, playerId: row.playerId, matches: row.matches, value }];
    })
    .sort((a, b) => b.value - a.value || a.player.localeCompare(b.player));
}
