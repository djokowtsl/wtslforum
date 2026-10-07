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
 * available components. Imported match stats are stored against the matching
 * player side so both players receive their own screenshot evidence.
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
        player_id,
        AVG((player_stats->>'firstServePct')::numeric)::float AS first_serve_pct,
        AVG((player_stats->>'firstServeWonPct')::numeric)::float AS first_serve_won_pct,
        AVG((player_stats->>'secondServeWonPct')::numeric)::float AS second_serve_won_pct,
        AVG((player_stats->>'aces')::numeric)::float AS aces,
        AVG((player_stats->>'doubleFaults')::numeric)::float AS double_faults,
        AVG((player_stats->>'firstServeReturnWonPct')::numeric)::float AS first_serve_return_won_pct,
        AVG((player_stats->>'secondServeReturnWonPct')::numeric)::float AS second_serve_return_won_pct,
        AVG((player_stats->>'breakPointsWonPct')::numeric)::float AS break_points_won_pct,
        AVG((player_stats->>'breakPointsSavedPct')::numeric)::float AS break_points_saved_pct,
        AVG((player_stats->>'tieBreaksWonPct')::numeric)::float AS tie_breaks_won_pct,
        AVG((player_stats->>'decidingSetsWonPct')::numeric)::float AS deciding_sets_won_pct
      FROM (
        SELECT player_one_id AS player_id, stats->'player1' AS player_stats
        FROM verified_matches
        UNION ALL
        SELECT player_two_id AS player_id, stats->'player2' AS player_stats
        FROM verified_matches
      ) sides
      WHERE jsonb_typeof(player_stats) = 'object'
      GROUP BY player_id
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
