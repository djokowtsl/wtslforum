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

  return (
    <details className="rating-evidence">
      <summary
        aria-label={`Show match sample counts for ${definition.label} rating`}
        title={`Show match sample counts for ${definition.label} rating`}
      >
        i
      </summary>
      <div className="rating-evidence__details">
        <strong>Match samples by component</strong>
        <ul>
          {definition.components.map((component) => {
            const count = counts?.[component];
            return (
              <li key={component}>
                {component}: {Number.isInteger(count) ? count : 'unavailable'}
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
