'use client';

import { useRouter } from 'next/navigation';

type MetricOption = { key: string; label: string };

const RESULT_METRIC_KEYS = new Set(['wins', 'win_pct', 'elo']);

export default function LeaderboardMetricPicker({
  current,
  tour,
  metrics,
}: {
  current: string;
  tour: string;
  metrics: readonly MetricOption[];
}) {
  const router = useRouter();
  const resultMetrics = metrics.filter((metric) => RESULT_METRIC_KEYS.has(metric.key));
  const screenshotMetrics = metrics.filter((metric) => !RESULT_METRIC_KEYS.has(metric.key));

  return (
    <div className="leaderboard-metric-picker">
      <label htmlFor="leaderboard-metric">View metric</label>
      <select
        id="leaderboard-metric"
        value={current}
        onChange={(event) => {
          router.push(
            `/leaderboard?tour=${encodeURIComponent(tour)}&metric=${encodeURIComponent(event.target.value)}`,
            { scroll: false },
          );
        }}
      >
        <optgroup label="Official results">
          {resultMetrics.map((metric) => (
            <option key={metric.key} value={metric.key}>{metric.label}</option>
          ))}
        </optgroup>
        <optgroup label="Screenshot statistics">
          {screenshotMetrics.map((metric) => (
            <option key={metric.key} value={metric.key}>{metric.label}</option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}