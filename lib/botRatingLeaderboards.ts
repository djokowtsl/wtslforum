import { sql } from './db';
import { LEADERBOARD_MIN_MATCHES } from './stats';
import { BOT_RATING_METRICS } from './botRatingMetrics';
import type { BotRating } from './botRatingMetrics';
import type { WtaProfileScreenshotStats } from './wtaProfileStatistics';
export { BOT_RATING_METRICS } from './botRatingMetrics';
export type { BotRating } from './botRatingMetrics';

const BOT_RATING_COMPONENT_LABELS = new Set<string>(
  BOT_RATING_METRICS.flatMap((metric) => [...metric.components]),
);

export const BOT_AGGREGATE_METRICS = [
  { key: 'bot_1st_serve_pct', label: '1st Serve %', sourceLabel: '1st Serve %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_aces', label: 'Aces', sourceLabel: 'Aces', valueFormat: 'number', direction: 'desc' },
  { key: 'bot_double_faults', label: 'Double Faults', sourceLabel: 'Double Faults', valueFormat: 'number', direction: 'asc' },
  { key: 'bot_fastest_serve', label: 'Fastest Serve', sourceLabel: 'Fastest Serve', valueFormat: 'number', direction: 'desc' },
  { key: 'bot_avg_1st_serve_speed', label: 'Avg 1st Serve Speed', sourceLabel: 'Avg 1st Serve Speed', valueFormat: 'number', direction: 'desc' },
  { key: 'bot_avg_2nd_serve_speed', label: 'Avg 2nd Serve Speed', sourceLabel: 'Avg 2nd Serve Speed', valueFormat: 'number', direction: 'desc' },
  { key: 'bot_winners', label: 'Winners', sourceLabel: 'Winners', valueFormat: 'number', direction: 'desc' },
  { key: 'bot_forced_errors', label: 'Forced Errors', sourceLabel: 'Forced Errors', valueFormat: 'number', direction: 'asc' },
  { key: 'bot_unforced_errors', label: 'Unforced Errors', sourceLabel: 'Unforced Errors', valueFormat: 'number', direction: 'asc' },
  { key: 'bot_net_points_won_pct', label: 'Net Points Won %', sourceLabel: 'Net Points Won %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_break_points_won_pct', label: 'Break Points Won %', sourceLabel: 'Break Points Won %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_total_points_won', label: 'Total Points Won', sourceLabel: 'Total Points Won', valueFormat: 'number', direction: 'desc' },
  { key: 'bot_short_rallies_won_pct', label: 'Short Rallies Won (<5) %', sourceLabel: 'Short Rallies Won (<5) %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_medium_rallies_won_pct', label: 'Medium Rallies Won (5-8) %', sourceLabel: 'Medium Rallies Won (5-8) %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_long_rallies_won_pct', label: 'Long Rallies Won (>8) %', sourceLabel: 'Long Rallies Won (>8) %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_average_rally_length', label: 'Average Rally Length', sourceLabel: 'Average Rally Length', valueFormat: 'number', direction: 'desc' },
  { key: 'bot_set_points_saved', label: 'Set Points Saved', sourceLabel: 'Set Points Saved', valueFormat: 'number', direction: 'desc' },
  { key: 'bot_match_points_saved', label: 'Match Points Saved', sourceLabel: 'Match Points Saved', valueFormat: 'number', direction: 'desc' },
  { key: 'bot_1st_serve_won_pct', label: '1st Serve Won %', sourceLabel: '1st Serve Won %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_2nd_serve_won_pct', label: '2nd Serve Won %', sourceLabel: '2nd Serve Won %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_return_points_won_pct', label: 'Return Points Won %', sourceLabel: 'Return Points Won %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_return_winners', label: 'Return Winners', sourceLabel: 'Return Winners', valueFormat: 'number', direction: 'desc' },
  { key: 'bot_breaks_games_pct', label: 'Breaks / Games %', sourceLabel: 'Breaks / Games %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_1st_serve_return_points_won_pct', label: '1st Serve Return Points Won %', sourceLabel: '1st Serve Return Points Won %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_2nd_serve_return_points_won_pct', label: '2nd Serve Return Points Won %', sourceLabel: '2nd Serve Return Points Won %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_break_points_saved_pct', label: 'Break Points Saved %', sourceLabel: 'Break Points Saved %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_tie_breaks_won_pct', label: 'Tie-breaks Won %', sourceLabel: 'Tie-breaks Won %', valueFormat: 'percent', direction: 'desc' },
  { key: 'bot_deciding_sets_won_pct', label: 'Deciding Sets Won %', sourceLabel: 'Deciding Sets Won %', valueFormat: 'percent', direction: 'desc' },
] as const;

export const BOT_METRICS = [...BOT_RATING_METRICS, ...BOT_AGGREGATE_METRICS] as const;
export type BotAggregateMetric = typeof BOT_AGGREGATE_METRICS[number]['key'];
export type BotMetric = BotRating | BotAggregateMetric;

export type BotLeaderboardRow = {
  player: string;
  playerId: string;
  wtslPlayerId: string | null;
  avatarUrl: string | null;
  flagUrl: string | null;
  country: string | null;
  matches: number;
  value: number;
  metricSampleCount: number | null;
  favoriteCharacter: string | null;
  favoriteCharacterCount: number | null;
  favoriteCharacterPercentage: number | null;
};

const botMetricByKey = new Map(BOT_METRICS.map((metric) => [metric.key, metric]));

export function isBotMetric(metric: string): metric is BotMetric {
  return botMetricByKey.has(metric as BotMetric);
}

let tableEnsured = false;
let comparisonTableEnsured = false;

async function ensureTable() {
  if (tableEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS bot_rating_leaderboards (
      tour TEXT NOT NULL,
      player_name TEXT NOT NULL,
      screenshots INT NOT NULL,
      serve NUMERIC,
      return_rating NUMERIC,
      pressure NUMERIC,
      rating_component_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      metric_sample_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      favorite_character TEXT,
      favorite_character_count INT,
      favorite_character_percentage NUMERIC,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tour, player_name)
    )
  `;
  await sql`
    ALTER TABLE bot_rating_leaderboards
      ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS rating_component_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS metric_sample_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS favorite_character TEXT,
      ADD COLUMN IF NOT EXISTS favorite_character_count INT,
      ADD COLUMN IF NOT EXISTS favorite_character_percentage NUMERIC
  `;
  tableEnsured = true;
}

async function ensureComparisonTable() {
  if (comparisonTableEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS bot_rating_comparison_population (
      tour TEXT NOT NULL,
      player_name TEXT NOT NULL,
      screenshots INT NOT NULL,
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tour, player_name)
    )
  `;
  comparisonTableEnsured = true;
}

export type BotRatingComparisonRow = {
  playerName: string;
  metrics: Record<string, number>;
};

function comparisonRowsFromDb(rows: any[]): BotRatingComparisonRow[] {
  return rows.flatMap((row) => {
    const rawMetrics = typeof row.metrics === 'string'
      ? JSON.parse(row.metrics)
      : row.metrics;
    if (!rawMetrics || typeof rawMetrics !== 'object' || Array.isArray(rawMetrics)) {
      return [];
    }
    const metrics: Record<string, number> = {};
    for (const [label, value] of Object.entries(rawMetrics)) {
      const number = finiteNumber(value);
      if (number !== null) metrics[label] = number;
    }
    return [{ playerName: String(row.playerName ?? ''), metrics }];
  });
}

/** Returns every imported screenshot player with the metrics that have observations. */
export async function botRatingComparisonPopulation(
  tour: string,
): Promise<BotRatingComparisonRow[]> {
  await ensureComparisonTable();
  const rows = await sql`
    SELECT player_name AS "playerName", metrics
    FROM bot_rating_comparison_population
    WHERE tour=${tour}
  `;
  return comparisonRowsFromDb(rows as any[]);
}

/** Existing ranked screenshot snapshot, retained as a fallback until the full sync lands. */
export async function botRatingEligibleComparisonPopulation(
  tour: string,
): Promise<BotRatingComparisonRow[]> {
  await ensureTable();
  const rows = await sql`
    SELECT player_name AS "playerName", metrics
    FROM bot_rating_leaderboards
    WHERE tour=${tour}
  `;
  return comparisonRowsFromDb(rows as any[]);
}

type SyncRow = {
  player?: unknown;
  matches?: unknown;
  ratings?: Record<string, unknown> | null;
  rating_component_counts?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
  metric_sample_counts?: Record<string, unknown> | null;
  favorite_character?: {
    character?: unknown;
    count?: unknown;
    percentage?: unknown;
  } | null;
};

type ComparisonSyncRow = {
  player?: unknown;
  matches?: unknown;
  metrics?: Record<string, unknown> | null;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function componentCountsFromDb(value: unknown): Record<string, number> {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return {}; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const counts: Record<string, number> = {};
  for (const [label, raw] of Object.entries(parsed)) {
    if (!BOT_RATING_COMPONENT_LABELS.has(label)) continue;
    const count = finiteNumber(raw);
    if (count !== null && Number.isInteger(count) && count > 0) counts[label] = count;
  }
  return counts;
}

export async function replaceBotRatingComparisonPopulation(
  tour: string,
  rows: ComparisonSyncRow[],
) {
  if (!['TE4', 'TE4_(F)'].includes(tour)) {
    throw new Error('Unsupported comparison population tour');
  }
  const prepared = rows.map((row) => {
    const playerName = String(row.player ?? '').trim();
    const screenshots = finiteNumber(row.matches);
    if (
      !playerName
      || screenshots === null
      || !Number.isInteger(screenshots)
      || screenshots < 0
    ) {
      throw new Error('Invalid player row in comparison population snapshot');
    }

    const metrics: Record<string, number> = {};
    for (const metric of BOT_AGGREGATE_METRICS) {
      const value = finiteNumber(row.metrics?.[metric.sourceLabel]);
      if (value !== null) metrics[metric.sourceLabel] = value;
    }
    return { player_name: playerName, screenshots, metrics };
  });

  if (!prepared.length) {
    throw new Error('Refusing to replace a comparison population with no rows');
  }
  if (new Set(prepared.map((row) => row.player_name)).size !== prepared.length) {
    throw new Error('Duplicate player names in comparison population snapshot');
  }
  if (!prepared.some((row) => Object.keys(row.metrics).length > 0)) {
    throw new Error('Refusing to replace a comparison population with no metric evidence');
  }

  await ensureComparisonTable();
  await sql`DELETE FROM bot_rating_comparison_population WHERE tour=${tour}`;
  await sql`
    INSERT INTO bot_rating_comparison_population(
      tour, player_name, screenshots, metrics, updated_at
    )
    SELECT
      ${tour}, player_name, screenshots, metrics, NOW()
    FROM jsonb_to_recordset(${JSON.stringify(prepared)}::jsonb)
      AS snapshot(player_name TEXT, screenshots INT, metrics JSONB)
  `;
  return { stored: prepared.length };
}

export async function replaceBotRatingLeaderboard(tour: string, rows: SyncRow[]) {
  await ensureTable();
  await sql`DELETE FROM bot_rating_leaderboards WHERE tour=${tour}`;
  let stored = 0;
  for (const row of rows) {
    const name = String(row.player ?? '').trim();
    const screenshots = Number(row.matches);
    if (!name || !Number.isInteger(screenshots) || screenshots < 0) continue;

    const ratingValue = (rating: BotRating) => {
      const metric = BOT_RATING_METRICS.find((entry) => entry.key === rating)!;
      return finiteNumber(row.ratings?.[metric.sourceLabel]);
    };
    const metrics: Record<string, number> = {};
    const metricSampleCounts: Record<string, number> = {};
    for (const metric of BOT_AGGREGATE_METRICS) {
      const value = finiteNumber(row.metrics?.[metric.sourceLabel]);
      if (value !== null) metrics[metric.sourceLabel] = value;
      const count = finiteNumber(row.metric_sample_counts?.[metric.sourceLabel]);
      if (count !== null && Number.isInteger(count) && count > 0) {
        metricSampleCounts[metric.sourceLabel] = count;
      }
    }
    const ratingComponentCounts: Record<string, number> = {};
    for (const [label, rawValue] of Object.entries(row.rating_component_counts ?? {})) {
      if (!BOT_RATING_COMPONENT_LABELS.has(label)) continue;
      const value = finiteNumber(rawValue);
      if (value !== null && Number.isInteger(value) && value > 0) {
        ratingComponentCounts[label] = value;
      }
    }

    const favorite = row.favorite_character;
    const favoriteCharacter = typeof favorite?.character === 'string' ? favorite.character.trim() || null : null;
    const rawFavoriteCharacterCount = finiteNumber(favorite?.count);
    const favoriteCharacterCount = rawFavoriteCharacterCount !== null
      && Number.isInteger(rawFavoriteCharacterCount)
      && rawFavoriteCharacterCount >= 0
      ? rawFavoriteCharacterCount
      : null;
    const rawFavoriteCharacterPercentage = finiteNumber(favorite?.percentage);
    const favoriteCharacterPercentage = rawFavoriteCharacterPercentage !== null
      && rawFavoriteCharacterPercentage >= 0
      && rawFavoriteCharacterPercentage <= 1
      ? rawFavoriteCharacterPercentage
      : null;

    await sql`
      INSERT INTO bot_rating_leaderboards(
        tour, player_name, screenshots, serve, return_rating, pressure,
        rating_component_counts, metrics, metric_sample_counts,
        favorite_character, favorite_character_count,
        favorite_character_percentage, updated_at
      )
      VALUES(
        ${tour}, ${name}, ${screenshots},
        ${ratingValue('serve')}, ${ratingValue('return')}, ${ratingValue('pressure')},
        ${JSON.stringify(ratingComponentCounts)}::jsonb,
        ${JSON.stringify(metrics)}::jsonb,
        ${JSON.stringify(metricSampleCounts)}::jsonb,
        ${favoriteCharacter},
        ${favoriteCharacterCount}, ${favoriteCharacterPercentage}, NOW()
      )
    `;
    stored++;
  }
  return { stored };
}

export async function botLeaderboard(tour: string, metric: BotMetric): Promise<BotLeaderboardRow[]> {
  await ensureTable();
  const definition = botMetricByKey.get(metric)!;
  const isRating = BOT_RATING_METRICS.some((entry) => entry.key === metric);
  const rows = await sql`
    SELECT
      b.player_name AS player,
      COALESCE(p.wtsl_player_id, b.player_name) AS "playerId",
      p.wtsl_player_id AS "wtslPlayerId",
      p.avatar_url AS "avatarUrl",
      p.flag_url AS "flagUrl",
      p.country,
      b.screenshots AS matches,
      CASE
        WHEN ${metric} = 'serve' THEN b.serve
        WHEN ${metric} = 'return' THEN b.return_rating
        WHEN ${metric} = 'pressure' THEN b.pressure
        WHEN NOT ${isRating} THEN (b.metrics ->> ${definition.sourceLabel})::numeric
        ELSE NULL
      END AS value,
      b.metric_sample_counts ->> ${definition.sourceLabel} AS "metricSampleCount",
      b.favorite_character AS "favoriteCharacter",
      b.favorite_character_count AS "favoriteCharacterCount",
      b.favorite_character_percentage AS "favoriteCharacterPercentage"
    FROM bot_rating_leaderboards b
    LEFT JOIN wtsl_players p ON p.tour=b.tour AND lower(p.name)=lower(b.player_name)
    WHERE b.tour=${tour}
      AND b.screenshots >= ${LEADERBOARD_MIN_MATCHES}
      AND CASE
        WHEN ${metric} = 'serve' THEN b.serve
        WHEN ${metric} = 'return' THEN b.return_rating
        WHEN ${metric} = 'pressure' THEN b.pressure
        WHEN NOT ${isRating} THEN (b.metrics ->> ${definition.sourceLabel})::numeric
        ELSE NULL
      END IS NOT NULL
  `;
  return rows
    .map((row: any) => ({
      player: row.player,
      playerId: String(row.playerId),
      wtslPlayerId: row.wtslPlayerId === null ? null : String(row.wtslPlayerId),
      avatarUrl: row.avatarUrl ? String(row.avatarUrl) : null,
      flagUrl: row.flagUrl ? String(row.flagUrl) : null,
      country: row.country ? String(row.country) : null,
      matches: Number(row.matches),
      value: Number(row.value),
      metricSampleCount: row.metricSampleCount === null || row.metricSampleCount === undefined
        ? null
        : Number(row.metricSampleCount),
      favoriteCharacter: row.favoriteCharacter ? String(row.favoriteCharacter) : null,
      favoriteCharacterCount: row.favoriteCharacterCount === null ? null : Number(row.favoriteCharacterCount),
      favoriteCharacterPercentage: row.favoriteCharacterPercentage === null ? null : Number(row.favoriteCharacterPercentage),
    }))
    .sort((a, b) => {
      const difference = definition.direction === 'asc' ? a.value - b.value : b.value - a.value;
      return difference || a.player.localeCompare(b.player);
    });
}

/** Read existing eligible screenshot aggregates, strictly bound to a WTA identity.
 * Profile averages do not require the 20-match leaderboard/rating threshold.
 */
export async function wtaProfileScreenshotStats(
  playerId: string,
): Promise<WtaProfileScreenshotStats | null> {
  const rows = await sql`
    SELECT b.screenshots, b.metrics, b.metric_sample_counts
    FROM bot_rating_leaderboards b
    JOIN wtsl_players p ON p.tour=b.tour AND lower(p.name)=lower(b.player_name)
    WHERE b.tour='TE4_(F)' AND p.wtsl_player_id=${playerId}
      AND b.screenshots > 0
    LIMIT 2
  `;
  if (rows.length > 1) throw new Error('Ambiguous WTA screenshot statistics identity');
  if (!rows[0]) return null;
  return {
    screenshots: Number(rows[0].screenshots),
    metrics: rows[0].metrics ?? {},
    metricSampleCounts: rows[0].metric_sample_counts ?? {},
  };
}

export type BotRatingStatsRow = {
  playerId: string;
  player: string;
  matches: number;
  ratings: Record<BotRating, number | null>;
  ratingComponentCounts: Record<string, number>;
};

export type BotRatingLeaderboardRow = {
  wtsl_player_id: string;
  name: string;
  avatar_url: string | null;
  flag_url: string | null;
  country: string | null;
  matches: number;
  value: number;
  ratingComponentCounts: Record<string, number>;
};

export async function botRatingStats(
  tour: string,
  playerId?: string,
): Promise<BotRatingStatsRow[]> {
  await ensureTable();
  const rows = await sql`
    SELECT
      p.wtsl_player_id AS "playerId",
      p.name AS player,
      b.screenshots AS matches,
      b.serve AS "serveRating",
      b.return_rating AS "returnRating",
      b.pressure AS "pressureRating",
      b.rating_component_counts AS "ratingComponentCounts"
    FROM bot_rating_leaderboards b
    JOIN wtsl_players p ON p.tour=b.tour AND lower(p.name)=lower(b.player_name)
    WHERE b.tour=${tour} AND b.screenshots >= ${LEADERBOARD_MIN_MATCHES}
      AND (b.serve IS NOT NULL OR b.return_rating IS NOT NULL OR b.pressure IS NOT NULL)
  `;
  return (rows as any[])
    .map((row) => ({
      playerId: String(row.playerId),
      player: String(row.player),
      matches: Number(row.matches),
      ratings: {
        serve: finiteNumber(row.serveRating),
        return: finiteNumber(row.returnRating),
        pressure: finiteNumber(row.pressureRating),
      },
      ratingComponentCounts: componentCountsFromDb(row.ratingComponentCounts),
    }))
    .filter((row) => !playerId || row.playerId === playerId);
}

export async function botRatingLeaderboard(
  tour: string,
  metric: BotRating,
): Promise<BotRatingLeaderboardRow[]> {
  await ensureTable();
  const definition = BOT_RATING_METRICS.find((entry) => entry.key === metric)!;
  const rows = await sql`
    SELECT
      p.wtsl_player_id,
      p.name,
      p.avatar_url,
      p.flag_url,
      p.country,
      b.screenshots AS matches,
      CASE
        WHEN ${metric} = 'serve' THEN b.serve
        WHEN ${metric} = 'return' THEN b.return_rating
        WHEN ${metric} = 'pressure' THEN b.pressure
        ELSE NULL
      END AS value,
      b.rating_component_counts AS "ratingComponentCounts"
    FROM bot_rating_leaderboards b
    JOIN wtsl_players p ON p.tour=b.tour AND lower(p.name)=lower(b.player_name)
    WHERE b.tour=${tour}
      AND b.screenshots >= ${LEADERBOARD_MIN_MATCHES}
      AND CASE
        WHEN ${metric} = 'serve' THEN b.serve
        WHEN ${metric} = 'return' THEN b.return_rating
        WHEN ${metric} = 'pressure' THEN b.pressure
        ELSE NULL
      END IS NOT NULL
    ORDER BY value DESC NULLS LAST, p.name ASC
  `;
  return (rows as any[]).map((row) => ({
    wtsl_player_id: String(row.wtsl_player_id),
    name: String(row.name),
    avatar_url: row.avatar_url ? String(row.avatar_url) : null,
    flag_url: row.flag_url ? String(row.flag_url) : null,
    country: row.country ? String(row.country) : null,
    matches: Number(row.matches),
    value: Number(row.value),
    ratingComponentCounts: componentCountsFromDb(row.ratingComponentCounts),
  }));
}