export type TourAverage = {
  value: number;
  playerCount: number;
};

export function calculateTourAverage(
  rows: readonly Record<string, unknown>[],
  metric: string,
  screenshotMetric: boolean,
): TourAverage | null;
