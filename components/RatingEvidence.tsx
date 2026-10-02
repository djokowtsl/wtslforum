import { BOT_RATING_METRICS, type BotRating } from '@/lib/botRatingMetrics';

export default function RatingEvidence({
  metric,
  counts,
}: {
  metric: BotRating;
  counts?: Record<string, number> | null;
}) {
  const definition = BOT_RATING_METRICS.find((item) => item.key === metric);
  if (!definition) return null;
  const evidence = definition.components
    .map((component) => `${component}: ${counts?.[component] ?? '—'}`)
    .join(' · ');
  const allCountsAvailable = definition.components.every(
    (component) => Number.isInteger(counts?.[component]) && (counts?.[component] ?? 0) > 0,
  );

  return (
    <small
      title={`Observation count for each ${definition.label} rating component`}
      style={{
        display: 'block',
        maxWidth: '28rem',
        marginTop: 3,
        opacity: 0.75,
        whiteSpace: 'normal',
        lineHeight: 1.3,
      }}
    >
      {allCountsAvailable ? 'Component matches: ' : 'Component matches (some unavailable): '}
      {evidence}
    </small>
  );
}