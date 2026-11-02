export type TourAverage = {
  value: number;
  playerCount: number;
};

export const DEFAULT_LEADERBOARD_METRIC: 'serve';

export type LeaderboardLeader = {
  name: string;
  playerId: string | null;
  avatarUrl: string | null;
  flagUrl: string | null;
  country: string | null;
  matches: number;
  row: Record<string, any>;
};

export function resolveLeaderboardLeader(
  rows: readonly Record<string, any>[],
  screenshotMetric: boolean,
  ratingMetric: boolean,
): LeaderboardLeader | null;

export function calculateTourAverage(
  rows: readonly Record<string, unknown>[],
  metric: string,
  screenshotMetric: boolean,
): TourAverage | null;

export type TourMetricDefinition = {
  key: string;
  label: string;
  source: 'official' | 'screenshot';
  valueFormat: 'number' | 'percent' | 'rating';
};

export function calculateTourMetricAverages(
  officialRows: readonly Record<string, unknown>[],
  screenshotRows: readonly {
    wtslPlayerId?: string | null;
    metricValues?: Record<string, unknown>;
  }[],
  metrics: readonly TourMetricDefinition[],
): (TourMetricDefinition & { average: TourAverage | null })[];

export function formatLeaderboardMetric(
  value: unknown,
  valueFormat?: 'number' | 'percent' | 'rating',
): string;
