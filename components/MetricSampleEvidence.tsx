export default function MetricSampleEvidence({
  metricLabel,
  sampleCount,
}: {
  metricLabel: string;
  sampleCount: number | null | undefined;
}) {
  const hasSampleCount = typeof sampleCount === 'number'
    && Number.isInteger(sampleCount)
    && sampleCount >= 0;
  const description = hasSampleCount
    ? `${sampleCount} ${sampleCount === 1 ? 'match' : 'matches'} contribute to ${metricLabel}.`
    : `Sample count unavailable for ${metricLabel}.`;

  return (
    <details className="metric-sample-evidence">
      <summary
        aria-label={`Show sample count for ${metricLabel}`}
        title={`Show sample count for ${metricLabel}`}
      >
        i
      </summary>
      <div className="metric-sample-evidence__details">
        <strong>Metric sample count</strong>
        <p>{description}</p>
      </div>
    </details>
  );
}
