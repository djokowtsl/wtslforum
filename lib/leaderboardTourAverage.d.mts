export type TourAverage = {
  value: number;
  playerCount: number;
};

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
