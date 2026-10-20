import { BOT_RATING_METRICS } from './botRatingMetrics';
import type { BotRating } from './botRatingMetrics';

export const RESULT_METRICS = [
  { key: 'wins', label: 'Wins', field: 'wins', valueFormat: 'number' },
  { key: 'win_pct', label: 'Win %', field: 'win_pct', valueFormat: 'percent' },
  { key: 'elo', label: 'Tour Elo', field: 'tour_elo', valueFormat: 'number' },
  { key: 'aces', label: 'Aces', field: 'aces', valueFormat: 'number' },
  { key: 'winners', label: 'Winners', field: 'winners', valueFormat: 'number' },
  { key: 'break_points', label: 'Break points won', field: 'break_points_won', valueFormat: 'number' },
  { key: 'first_serve_pct', label: '1st serve %', field: 'first_serve_pct', valueFormat: 'percent' },
] as const;

export type ResultMetric = typeof RESULT_METRICS[number]['key'];

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

export type BotAggregateMetric = typeof BOT_AGGREGATE_METRICS[number]['key'];
export const BOT_METRICS = [...BOT_RATING_METRICS, ...BOT_AGGREGATE_METRICS] as const;
export type BotMetric = BotRating | BotAggregateMetric;
export type ForumMetric = ResultMetric | BotMetric;
export type MetricValueFormat = 'number' | 'percent' | 'rating';

export type ForumLeaderboardMetricDefinition =
  | {
    key: ResultMetric;
    label: string;
    source: 'official';
    valueFormat: 'number' | 'percent';
    field: string;
  }
  | {
    key: BotMetric;
    label: string;
    source: 'screenshot';
    valueFormat: MetricValueFormat;
  };

export const FORUM_LEADERBOARD_METRICS: ForumLeaderboardMetricDefinition[] = [
  ...RESULT_METRICS.map((metric) => ({
    key: metric.key,
    label: metric.label,
    source: 'official' as const,
    valueFormat: metric.valueFormat,
    field: metric.field,
  })),
  ...BOT_METRICS.map((metric) => ({
    key: metric.key,
    label: metric.label,
    source: 'screenshot' as const,
    valueFormat: metric.valueFormat,
  })),
];

export const FORUM_METRICS = FORUM_LEADERBOARD_METRICS.map(({ key, label }) => ({ key, label }));

const botMetricKeys = new Set<string>(BOT_METRICS.map((metric) => metric.key));

export function isBotMetric(metric: string): metric is BotMetric {
  return botMetricKeys.has(metric);
}
