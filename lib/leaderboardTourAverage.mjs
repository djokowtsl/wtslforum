const resultMetricFields = {
  wins: 'wins',
  win_pct: 'win_pct',
  elo: 'tour_elo',
  aces: 'aces',
  winners: 'winners',
  break_points: 'break_points_won',
  first_serve_pct: 'first_serve_pct',
};

const officialMeasuredMetrics = new Set([
  'aces',
  'winners',
  'break_points',
  'first_serve_pct',
]);

/**
 * Average the values in the current metric's already-qualified leaderboard rows.
 *
 * @param {readonly Record<string, unknown>[]} rows
 * @param {string} metric
 * @param {boolean} screenshotMetric
 * @returns {{ value: number, playerCount: number } | null}
 */
export function calculateTourAverage(rows, metric, screenshotMetric) {
  const field = screenshotMetric ? 'value' : resultMetricFields[metric];
  if (!field) return null;

  const values = rows.flatMap((row) => {
    const raw = row[field];
    if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
      return [];
    }
    const value = Number(raw);
    return Number.isFinite(value) ? [value] : [];
  });

  if (values.length === 0) return null;

  // The official stats sync stores an absent averages feed as zero. When every eligible player
  // has zero for one of these measured stats, treat it as missing coverage, not a genuine average.
  if (
    !screenshotMetric
    && officialMeasuredMetrics.has(metric)
    && values.every((value) => value === 0)
  ) {
    return null;
  }

  return {
    value: values.reduce((sum, value) => sum + value, 0) / values.length,
    playerCount: values.length,
  };
}

/**
 * Calculate each metric from the same source-specific rows used by its leaderboard.
 *
 * @param {readonly Record<string, unknown>[]} officialRows
 * @param {readonly { wtslPlayerId?: string | null, metricValues?: Record<string, unknown> }[]} screenshotRows
 * @param {readonly { key: string, label: string, source: 'official' | 'screenshot', valueFormat: string }[]} metrics
 */
export function calculateTourMetricAverages(officialRows, screenshotRows, metrics) {
  return metrics.map((metric) => {
    const average = metric.source === 'official'
      ? calculateTourAverage(officialRows, metric.key, false)
      : calculateTourAverage(
        screenshotRows
          .filter((row) => metric.valueFormat !== 'rating' || Boolean(row.wtslPlayerId))
          .map((row) => ({ value: row.metricValues?.[metric.key] })),
        metric.key,
        true,
      );

    return { ...metric, average };
  });
}

/**
 * @param {unknown} value
 * @param {'number' | 'percent' | 'rating'} [valueFormat]
 */
export function formatLeaderboardMetric(value, valueFormat = 'number') {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return '—';
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (valueFormat === 'rating') return number.toFixed(1);
  if (valueFormat === 'percent') {
    const percentage = number >= 0 && number <= 1 ? number * 100 : number;
    return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(percentage)}%`;
  }
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(number);
}
