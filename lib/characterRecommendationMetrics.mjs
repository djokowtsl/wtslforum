export function formatRecommendationMetricValue(metric, value) {
  if (value === null || value === undefined) return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  if (String(metric).trim().endsWith('%')) {
    return `${Math.floor(number * 100)}%`;
  }
  return String(value);
}
