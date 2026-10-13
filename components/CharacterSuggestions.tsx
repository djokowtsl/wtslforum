import type { CoreCharacterRecommendation } from '@/lib/wtsl-core';

function groupName(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ordinal(value: number) {
  const integer = Math.round(value);
  const lastTwo = integer % 100;
  const suffix = lastTwo >= 11 && lastTwo <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[integer % 10] || 'th';
  return `${integer}${suffix}`;
}

function metricEvidence(
  metric?: { metric: string; value?: number; percentile: number } | null,
) {
  if (!metric) return '';
  const value = metric.value == null ? '' : ` (${metric.value})`;
  return `${metric.metric}${value}, ${ordinal(metric.percentile)} field percentile`;
}

export default function CharacterSuggestions({
  recommendations,
}: {
  recommendations: CoreCharacterRecommendation[] | null;
}) {
  return (
    <section className="character-suggestions" aria-labelledby="character-suggestions-title">
      <div className="character-suggestions-heading">
        <h3 id="character-suggestions-title">Character suggestions</h3>
        <p>
          Uses the same character-fit scorer as Discord <code>/mystats</code>,
          with the performance metrics available on this Forum profile.
        </p>
      </div>

      {recommendations === null ? (
        <p className="character-suggestions-empty">
          Suggestions are temporarily unavailable. Your other dashboard stats are unaffected.
        </p>
      ) : recommendations.length === 0 ? (
        <p className="character-suggestions-empty">
          Suggestions appear when at least two player-stat areas have enough comparison data.
        </p>
      ) : (
        <ol className="character-suggestion-list">
          {recommendations.map((recommendation, index) => (
            <li className="character-suggestion-card" key={recommendation.character}>
              <div className="character-suggestion-title">
                <span>{index + 1}</span>
                <strong>{recommendation.character}</strong>
                {recommendation.style && <small>{recommendation.style}</small>}
              </div>
              <p>
                Built around your{' '}
                <strong>{groupName(recommendation.strength_group)}</strong> strength,
                with <strong>{groupName(recommendation.development_group)}</strong> as
                the development focus.
              </p>
              <p>{recommendation.mechanics_reason}</p>
              <p>{recommendation.development_route}</p>
              {(recommendation.player_strength_metric || recommendation.player_development_metric) && (
                <p className="character-suggestion-evidence">
                  {metricEvidence(recommendation.player_strength_metric)}
                  {recommendation.player_strength_metric && recommendation.player_development_metric
                    ? ' · '
                    : ''}
                  {metricEvidence(recommendation.player_development_metric)}
                </p>
              )}
              {recommendation.edge_details.length > 0 && (
                <p className="character-suggestion-evidence">
                  Character ratings: {recommendation.edge_details
                    .slice(0, 3)
                    .map((edge) => `${edge.attribute} ${edge.value}/100`)
                    .join(' · ')}
                </p>
              )}
              {recommendation.tradeoff && (
                <p className="character-suggestion-tradeoff">
                  Trade-off: {recommendation.tradeoff}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      <p className="character-suggestions-note">
        Forum suggestions use the available dashboard metrics; Discord <code>/mystats</code>
        may include fuller MatchLog data.
      </p>
    </section>
  );
}
