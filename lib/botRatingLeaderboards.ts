import { sql } from './db';

export const BOT_RATING_METRICS = [
  { key: 'serve', label: 'Serve', sourceLabel: 'Serve (Overall)', valueFormat: 'rating', direction: 'desc' },
  { key: 'return', label: 'Return', sourceLabel: 'Return (Overall)', valueFormat: 'rating', direction: 'desc' },
  { key: 'pressure', label: 'Under Pressure', sourceLabel: 'Under Pressure', valueFormat: 'rating', direction: 'desc' },
] as const;

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
export type BotRating = typeof BOT_RATING_METRICS[number]['key'];
export type BotAggregateMetric = typeof BOT_AGGREGATE_METRICS[number]['key'];
export type BotMetric = BotRating | BotAggregateMetric;

export type BotLeaderboardRow = {
  player: string;
  playerId: string;
  matches: number;
  value: number;
  favoriteCharacter: string | null;
  favoriteCharacterCount: number | null;
  favoriteCharacterPercentage: number | null;
};

const botMetricByKey = new Map(BOT_METRICS.map((metric) => [metric.key, metric]));

export function isBotMetric(metric: string): metric is BotMetric {
  return botMetricByKey.has(metric as BotMetric);
}

let tableEnsured = false;

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
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
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
      ADD COLUMN IF NOT EXISTS favorite_character TEXT,
      ADD COLUMN IF NOT EXISTS favorite_character_count INT,
      ADD COLUMN IF NOT EXISTS favorite_character_percentage NUMERIC
  `;
  tableEnsured = true;
}

type SyncRow = {
  player?: unknown;
  matches?: unknown;
  ratings?: Record<string, unknown> | null;
  metrics?: Record<string, unknown> | null;
  favorite_character?: {
    character?: unknown;
    count?: unknown;
    percentage?: unknown;
  } | null;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
    for (const metric of BOT_AGGREGATE_METRICS) {
      const value = finiteNumber(row.metrics?.[metric.sourceLabel]);
      if (value !== null) metrics[metric.sourceLabel] = value;
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
        metrics, favorite_character, favorite_character_count,
        favorite_character_percentage, updated_at
      )
      VALUES(
        ${tour}, ${name}, ${screenshots},
        ${ratingValue('serve')}, ${ratingValue('return')}, ${ratingValue('pressure')},
        ${JSON.stringify(metrics)}::jsonb, ${favoriteCharacter},
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
      b.screenshots AS matches,
      CASE
        WHEN ${metric} = 'serve' THEN b.serve
        WHEN ${metric} = 'return' THEN b.return_rating
        WHEN ${metric} = 'pressure' THEN b.pressure
        WHEN NOT ${isRating} THEN (b.metrics ->> ${definition.sourceLabel})::numeric
        ELSE NULL
      END AS value,
      b.favorite_character AS "favoriteCharacter",
      b.favorite_character_count AS "favoriteCharacterCount",
      b.favorite_character_percentage AS "favoriteCharacterPercentage"
    FROM bot_rating_leaderboards b
    LEFT JOIN wtsl_players p ON p.tour=b.tour AND lower(p.name)=lower(b.player_name)
    WHERE b.tour=${tour}
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
      matches: Number(row.matches),
      value: Number(row.value),
      favoriteCharacter: row.favoriteCharacter ? String(row.favoriteCharacter) : null,
      favoriteCharacterCount: row.favoriteCharacterCount === null ? null : Number(row.favoriteCharacterCount),
      favoriteCharacterPercentage: row.favoriteCharacterPercentage === null ? null : Number(row.favoriteCharacterPercentage),
    }))
    .sort((a, b) => {
      const difference = definition.direction === 'asc' ? a.value - b.value : b.value - a.value;
      return difference || a.player.localeCompare(b.player);
    });
}

export async function botRatingLeaderboard(tour: string, metric: BotRating): Promise<BotLeaderboardRow[]> {
  return botLeaderboard(tour, metric);
}