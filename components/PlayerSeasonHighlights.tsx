import type { PlayerSeasonHighlights as Highlights } from '@/lib/playerSeasonHighlights';

export default function PlayerSeasonHighlights({ highlights, unavailable = false }: { highlights: Highlights; unavailable?: boolean }) {
  return (
    <section className="season-highlights" aria-label={`${highlights.year} season highlights`}>
      <div className="season-highlights-head">
        <h3>Season highlights</h3>
        <span>{highlights.year}</span>
      </div>
      {unavailable ? (
        <p className="season-highlights-empty">Official season match results are unavailable right now. Please try again later.</p>
      ) : highlights.matches === 0 ? (
        <p className="season-highlights-empty">No completed year-to-date matches are available for this player.</p>
      ) : (
        <>
          <div className="season-highlight-stats">
            <div><strong>{highlights.wins}-{highlights.losses}</strong><small>Year-to-date record</small></div>
            <div><strong>{highlights.titles.length}</strong><small>Tournaments won</small></div>
            <div><strong>{highlights.finalsReached}</strong><small>Finals reached</small></div>
          </div>
          <div className="season-highlight-lists">
            {highlights.titles.length > 0 && (
              <div>
                <h4>Titles won</h4>
                <ul>{highlights.titles.map((name) => <li key={name}>{name}</li>)}</ul>
              </div>
            )}
            {highlights.runnerUps.length > 0 && (
              <div>
                <h4>Runner-up finishes</h4>
                <ul>{highlights.runnerUps.map((name) => <li key={name}>{name}</li>)}</ul>
              </div>
            )}
            {highlights.bestRuns.length > 0 && (
              <div>
                <h4>Deepest tournament runs</h4>
                <ul>
                  {highlights.bestRuns.map((run) => (
                    <li key={`${run.tournament}-${run.round}`}>
                      <span>{run.tournament}</span><span className="season-run-round">{run.round}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}