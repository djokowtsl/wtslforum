/**
 * Rule-based "coaching" commentary for a player's dashboard, ported from the Discord bot's
 * `player_insights.py`. This is deliberately NOT an LLM call — it's the same deterministic
 * template-filling the bot already uses: bucket a handful of synced stat averages into
 * serve/return/rally groups, work out where this player sits in the tour's field for each
 * group (percentile among qualifying players), then fill in canned strength/development/
 * tactical sentences for the strongest and weakest metric. Cheap, fast, and reads like analysis
 * without needing any external AI infrastructure.
 */
import { sql } from './db';
import { LEADERBOARD_MIN_MATCHES } from './stats';
import { normalizePlayerName } from './queries';
import {
  botRatingComparisonPopulation,
  botRatingEligibleComparisonPopulation,
} from './botRatingLeaderboards';

type MetricDef = {
  key: string; // column on player_stats_summary
  label: string; // display name, also the template lookup key
  group: 'serve' | 'return' | 'rally';
  lowerIsBetter?: boolean;
};

const METRICS: MetricDef[] = [
  { key: 'first_serve_pct', label: '1st Serve %', group: 'serve' },
  { key: 'avg_first_serve_won_pct', label: '1st Serve Won %', group: 'serve' },
  { key: 'avg_second_serve_won_pct', label: '2nd Serve Won %', group: 'serve' },
  { key: 'aces', label: 'Aces', group: 'serve' },
  { key: 'avg_double_faults', label: 'Double Faults', group: 'serve', lowerIsBetter: true },
  { key: 'avg_return_won_pct', label: 'Return Points Won %', group: 'return' },
  { key: 'break_points_won', label: 'Break Points Won %', group: 'return' },
  { key: 'avg_short_rally_pct', label: 'Short Rallies Won (<5) %', group: 'rally' },
  { key: 'avg_medium_rally_pct', label: 'Medium Rallies Won (5-8) %', group: 'rally' },
  { key: 'avg_long_rally_pct', label: 'Long Rallies Won (>8) %', group: 'rally' },
  { key: 'winners', label: 'Winners', group: 'rally' },
  { key: 'avg_unforced_errors', label: 'Unforced Errors', group: 'rally', lowerIsBetter: true },
];

const STRENGTH_CONTEXT: Record<string, string> = {
  '1st Serve %': 'You are starting points on the front foot by landing first serves consistently.',
  '1st Serve Won %': 'Your first serve is creating short balls and protecting service games.',
  '2nd Serve Won %': 'Your second serve is holding up well when opponents attack it.',
  Aces: 'You are earning free points and applying immediate scoreboard pressure.',
  'Double Faults': 'A low double-fault rate keeps your service games under control and avoids free points.',
  'Return Points Won %': 'Your overall return work consistently puts opponents under pressure.',
  'Break Points Won %': 'You are converting important return opportunities efficiently.',
  'Short Rallies Won (<5) %': 'Your serve-plus-one and return-plus-one patterns are effective.',
  'Medium Rallies Won (5-8) %': 'You are building points effectively through the middle phase of rallies.',
  'Long Rallies Won (>8) %': 'Your patience and physical consistency are strong in extended exchanges.',
  Winners: 'You are finishing enough points proactively rather than waiting for errors.',
  'Unforced Errors': 'A low unforced-error rate gives your opponents fewer free points.',
};

const DEVELOPMENT_CONTEXT: Record<string, string> = {
  '1st Serve %': 'Raise first-serve reliability without taking away too much pace or placement.',
  '1st Serve Won %': 'Improve first-serve location and the quality of the next attacking ball.',
  '2nd Serve Won %': 'Build a heavier, safer second serve and a clearer second-serve-plus-one pattern.',
  Aces: 'Use disguise and wider placement to create more unreturned serves.',
  'Double Faults': 'Reduce free points by giving the second serve more net clearance, shape, and target margin.',
  'Return Points Won %': 'Improve return depth so more points begin from a neutral or attacking position.',
  'Break Points Won %': 'Use a committed return pattern on break points instead of changing strategy under pressure.',
  'Short Rallies Won (<5) %': 'Sharpen serve-plus-one and return-plus-one patterns for the first four shots.',
  'Medium Rallies Won (5-8) %': 'Improve direction changes and court position once the point becomes neutral.',
  'Long Rallies Won (>8) %': 'Develop rally tolerance, height over the net, and disciplined target selection.',
  Winners: 'Create finishing chances with better court position before accelerating.',
  'Unforced Errors': 'Lower the unforced-error rate by using larger targets and better shot selection under stress.',
};

const TACTICAL_STRENGTH: Record<string, string> = {
  '1st Serve %': 'Use the first serve to open the court, then attack the first ball into the space it creates.',
  '1st Serve Won %': 'Build points around serve-plus-one: serve to the weaker location, then take the first short reply.',
  '2nd Serve Won %': 'Use a heavier second serve with a clear target, then play the next ball with controlled aggression.',
  Aces: 'Look for wide or body serve patterns that create free points or predictable returns.',
  'Double Faults': 'Keep the low-risk second serve in play and make the opponent earn every return point.',
  'Return Points Won %': 'Start return games with depth and margin, then build pressure before changing direction.',
  'Break Points Won %': 'On break chances, repeat the highest-percentage return pattern instead of chasing a low-margin winner.',
  'Short Rallies Won (<5) %': 'Prioritise the first four shots: serve-plus-one or return-plus-one, with the first attack going to space.',
  'Medium Rallies Won (5-8) %': 'Use patient cross-court construction and change direction only after earning a stable court position.',
  'Long Rallies Won (>8) %': 'Extend exchanges when needed, use height and depth, and wait for the opponent to give up the short ball.',
  Winners: 'Construct the point until the court opens, then accelerate into the space rather than forcing the first attack.',
  'Unforced Errors': 'Use larger targets early and make the opponent hit one more ball before taking the risk.',
};

const TACTICAL_DEVELOPMENT: Record<string, string> = {
  '1st Serve %': 'Choose two high-margin first-serve targets and accept a neutral first ball rather than forcing placement.',
  '1st Serve Won %': 'Use safer locations and a clearer serve-plus-one target so the first attacking ball is played from balance.',
  '2nd Serve Won %': 'Add height and margin to the second serve, then protect the next ball instead of chasing immediate offence.',
  Aces: 'Use placement and disguise to create predictable returns; do not turn the lack of aces into low-percentage serving.',
  'Double Faults': 'Prioritise a repeatable second-serve target with more net clearance and make the opponent win the rally.',
  'Return Points Won %': 'Protect return depth and avoid donating short replies before trying to create pressure.',
  'Break Points Won %': 'Use the same trusted return pattern on break points and let pressure create the next opportunity.',
  'Short Rallies Won (<5) %': 'Make the first four shots safer and deeper, especially the serve-plus-one or return-plus-one ball.',
  'Medium Rallies Won (5-8) %': 'Stay patient through the neutral phase and earn court position before changing direction.',
  'Long Rallies Won (>8) %': 'Avoid being drawn into extended exchanges: use depth, change height, and look for the first shorter ball.',
  Winners: 'Create the opening with court position first, then finish with a controlled target rather than forcing the winner.',
  'Unforced Errors': 'Use bigger targets and a clearer rally shape until the opponent gives you a higher-percentage attack.',
};

const TRAINING_FOCUS: Record<'serve' | 'return' | 'rally', string> = {
  serve: 'Build the next practice block around serve quality: rehearse first-serve locations, then play second-serve-plus-one points with a double-fault penalty and generous second-serve targets.',
  return: 'Build the next practice block around return pressure: alternate compact first-serve blocks with aggressive second-serve returns, then play out points from the first neutral ball.',
  rally: 'Build the next practice block around rally tolerance and point construction: use cross-court consistency targets, controlled direction changes, and finish only after earning court position.',
};

function percentileOf(value: number, all: number[], lowerIsBetter?: boolean): number {
  if (!all.length) return 50;
  const below = all.filter((v) => (lowerIsBetter ? v > value : v < value)).length;
  const equal = all.filter((v) => v === value).length;
  // Standard "percent of the field this player is better than or tied with" percentile.
  return Math.round(((below + equal / 2) / all.length) * 100);
}

function fieldStandingText(percentile: number, sampleSize: number): string {
  let level: string;
  if (percentile >= 85) level = 'among the strongest';
  else if (percentile <= 15) level = 'among the weakest';
  else if (percentile >= 60) level = 'above average';
  else if (percentile <= 40) level = 'below average';
  else level = 'around the field average';
  const sample = sampleSize > 0 ? ` across ${sampleSize} comparable players` : '';
  return `${level} (${percentile}th percentile${sample})`;
}

export type MetricInsight = {
  label: string;
  group: 'serve' | 'return' | 'rally';
  value: number;
  percentile: number;
  players: number;
};

export type PlayerInsightReport = {
  qualifies: boolean; // at least one metric has comparable observations on this tour
  groupPercentiles: Record<'serve' | 'return' | 'rally', number | null>;
  strongest: (MetricInsight & { commentary: string; tactic: string; standing: string }) | null;
  weakest: (MetricInsight & { commentary: string; tactic: string; standing: string }) | null;
  trainingFocus: string | null;
};

/**
 * Uses the bot's full screenshot-stat population when available. Each metric is compared
 * only with players who have an observation for that metric; the website's match-count
 * threshold is retained only for the legacy WTSL-stat fallback.
 */
export async function buildPlayerInsights(playerId: string, tour: string): Promise<PlayerInsightReport> {
  const empty = (): PlayerInsightReport => ({
    qualifies: false,
    groupPercentiles: { serve: null, return: null, rally: null },
    strongest: null,
    weakest: null,
    trainingFocus: null,
  });
  const numericValue = (value: unknown): number | null => {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const metricValue = (row: Record<string, unknown>, metric: MetricDef) =>
    numericValue(row[metric.key] ?? row[metric.label]);

  const screenshotRows = await botRatingComparisonPopulation(tour);
  const linkedPlayers = await sql`
    SELECT name
    FROM wtsl_players
    WHERE wtsl_player_id=${playerId} AND tour=${tour}
    LIMIT 2
  `;
  const targetName = normalizePlayerName(String(linkedPlayers[0]?.name ?? ''));
  const fullMatches = screenshotRows.filter(
    (row) => normalizePlayerName(row.playerName) === targetName,
  );
  let field: Record<string, unknown>[];
  let me: Record<string, unknown> | undefined;
  const hasCoachMetric = (row: Record<string, unknown>) =>
    METRICS.some((metric) => metricValue(row, metric) !== null);
  if (targetName && fullMatches.length === 1 && hasCoachMetric(fullMatches[0].metrics)) {
    field = screenshotRows.map((row) => row.metrics);
    me = fullMatches[0].metrics;
  } else {
    // Use the previous screenshot snapshot until the full verified population is synced,
    // or if the full import does not contain one unambiguous target row.
    const eligibleRows = await botRatingEligibleComparisonPopulation(tour);
    const eligibleMatches = eligibleRows.filter(
      (row) => normalizePlayerName(row.playerName) === targetName,
    );
    if (targetName && eligibleMatches.length === 1 && hasCoachMetric(eligibleMatches[0].metrics)) {
      field = eligibleRows.map((row) => row.metrics);
      me = eligibleMatches[0].metrics;
    } else {
      const rows = await sql`
        SELECT player_id, matches, aces, winners, break_points_won, first_serve_pct,
          avg_double_faults, avg_net_points_pct, avg_forced_errors, avg_unforced_errors,
          avg_short_rally_pct, avg_medium_rally_pct, avg_long_rally_pct,
          avg_first_serve_won_pct, avg_second_serve_won_pct, avg_return_won_pct
        FROM player_stats_summary
        WHERE tour=${tour} AND matches >= ${LEADERBOARD_MIN_MATCHES}
      `;
      field = rows as Record<string, unknown>[];
      me = field.find((row) => String(row.player_id) === String(playerId));
    }
  }
  if (!me) return empty();

  const metricInsights: MetricInsight[] = [];
  for (const metric of METRICS) {
    const value = metricValue(me, metric);
    if (value === null) continue;
    const all = field
      .map((row) => metricValue(row, metric))
      .filter((candidate): candidate is number => candidate !== null);
    if (all.length < 2) continue;
    metricInsights.push({
      label: metric.label,
      group: metric.group,
      value,
      percentile: percentileOf(value, all, metric.lowerIsBetter),
      players: all.length,
    });
  }
  if (metricInsights.length === 0) return empty();

  const groupPercentiles: Record<'serve' | 'return' | 'rally', number | null> = { serve: null, return: null, rally: null };
  (['serve', 'return', 'rally'] as const).forEach((g) => {
    const inGroup = metricInsights.filter((m) => m.group === g);
    groupPercentiles[g] = inGroup.length ? Math.round(inGroup.reduce((s, m) => s + m.percentile, 0) / inGroup.length) : null;
  });

  const sorted = [...metricInsights].sort((a, b) => b.percentile - a.percentile);
  const strongestMetric = sorted[0] ?? null;
  const weakestMetric = sorted[sorted.length - 1] ?? null;
  const strongest = strongestMetric
    ? { ...strongestMetric, commentary: STRENGTH_CONTEXT[strongestMetric.label] ?? 'You should keep building this part of your current performance profile.', tactic: TACTICAL_STRENGTH[strongestMetric.label] ?? 'Play to the larger target, protect the neutral ball, and attack only after earning the opening.', standing: fieldStandingText(strongestMetric.percentile, strongestMetric.players) }
    : null;
  const weakest = weakestMetric
    ? { ...weakestMetric, commentary: DEVELOPMENT_CONTEXT[weakestMetric.label] ?? 'Prioritise this part of your current performance profile in training.', tactic: TACTICAL_DEVELOPMENT[weakestMetric.label] ?? 'Play to the larger target, protect the neutral ball, and attack only after earning the opening.', standing: fieldStandingText(weakestMetric.percentile, weakestMetric.players) }
    : null;

  const trainingFocus = weakest ? TRAINING_FOCUS[weakest.group] : null;

  return { qualifies: true, groupPercentiles, strongest, weakest, trainingFocus };
}
