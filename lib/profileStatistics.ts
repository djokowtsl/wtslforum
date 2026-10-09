export type ProfileScreenshotStats = {
  screenshots: number;
  metrics: Record<string, unknown>;
  metricSampleCounts: Record<string, unknown>;
};

const PROFILE_METRICS = [
  ['First serve %', '1st Serve %', 'percent'],
  ['Avg aces', 'Aces', 'number'],
  ['Avg double faults', 'Double Faults', 'number'],
  ['Avg 1st serve speed', 'Avg 1st Serve Speed', 'speed'],
  ['Avg 2nd serve speed', 'Avg 2nd Serve Speed', 'speed'],
  ['Avg net points %', 'Net Points Won %', 'percent'],
  ['Avg winners', 'Winners', 'number'],
  ['Avg forced errors', 'Forced Errors', 'number'],
  ['Avg unforced errors', 'Unforced Errors', 'number'],
  ['Breakpoint conversion %', 'Break Points Won %', 'percent'],
  ['Short rallies won %', 'Short Rallies Won (<5) %', 'percent'],
  ['Medium rallies won %', 'Medium Rallies Won (5-8) %', 'percent'],
  ['Long rallies won %', 'Long Rallies Won (>8) %', 'percent'],
  ['1st serve points won %', '1st Serve Won %', 'percent'],
  ['2nd serve points won %', '2nd Serve Won %', 'percent'],
  ['Return points won %', 'Return Points Won %', 'percent'],
  ['Avg rally length', 'Average Rally Length', 'number'],
] as const;

function finiteNumber(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && !raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function buildProfileStatLines(snapshot: ProfileScreenshotStats | null) {
  return PROFILE_METRICS.map(([label, sourceLabel, format]) => {
    const rawValue = finiteNumber(snapshot?.metrics[sourceLabel]);
    const rawCount = finiteNumber(snapshot?.metricSampleCounts[sourceLabel]);
    const sampleCount = rawCount !== null && Number.isInteger(rawCount)
      && rawCount > 0 && rawCount <= (snapshot?.screenshots ?? 0) ? rawCount : null;
    const value = format === 'percent' && rawValue !== null && rawValue <= 1
      ? rawValue * 100 : rawValue;
    if (sampleCount === null || value === null || value < 0
      || (format === 'percent' && value > 100)) {
      return { label, value: 'Unavailable', sampleCount: null };
    }
    const formatted = new Intl.NumberFormat('en-GB', {
      maximumFractionDigits: 2,
    }).format(value);
    return {
      label,
      value: `${formatted}${format === 'percent' ? '%' : format === 'speed' ? ' km/h' : ''}`,
      sampleCount,
    };
  });
}
