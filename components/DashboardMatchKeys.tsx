import type { DashboardMatchKeys } from '@/lib/dashboardMatchKeys';
import { formatMatchKeyMetric } from '@/lib/dashboardMatchKeys';

function fixtureDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  });
}

export default function DashboardMatchKeys({
  data,
  unavailable = false,
}: {
  data: DashboardMatchKeys | null;
  unavailable?: boolean;
}) {
  const scheduledAt = data ? fixtureDate(data.fixture.scheduled_at) : null;
  return (
    <section className="panel" aria-label="Upcoming match keys">
      <div className="panel-head">
        <h3 className="display">Upcoming match keys</h3>
      </div>
      {unavailable ? (
        <p className="empty">Upcoming WTSL fixtures or MatchLog stats are temporarily unavailable. Please try again later.</p>
      ) : !data ? (
        <p className="empty">No upcoming fixture is listed for this verified player yet. Match keys appear when WTSL lists your player in a fixture.</p>
      ) : (
        <>
          <p className="muted">
            {data.fixture.tournament || 'Upcoming WTSL fixture'}
            {scheduledAt ? ` · ${scheduledAt}` : ''}
            {' · MatchLog'}
          </p>
          <h4 className="match-keys-opponent">Your keys vs {data.opponentName}</h4>
          {data.noPlayerStats ? (
            <p className="empty">No MatchLog statistics are available for your verified player yet.</p>
          ) : data.keys.length === 0 ? (
            <p className="empty">There is not enough comparable MatchLog evidence to identify a clear key for this matchup.</p>
          ) : (
            <>
              <p className="muted">
                Your MatchLog sample: {data.playerMatches ?? '—'} matches
                {data.opponentMatches !== null ? ` · Opponent: ${data.opponentMatches} matches` : ' · Opponent MatchLog stats unavailable'}
              </p>
              <div className="insight-grid">
                {data.keys.map((key, index) => (
                  <article className={key.playerHasEdge ? 'insight-card insight-strength' : 'insight-card insight-development'} key={`${key.category}-${key.metric}`}>
                    <small>Key {index + 1} · {key.category}</small>
                    <p>
                      {key.opponentValue === null
                        ? `Your strongest available rating is ${key.metric} (${formatMatchKeyMetric(key.metric, key.playerValue)}).`
                        : `${key.metric}: ${formatMatchKeyMetric(key.metric, key.playerValue)} vs ${data.opponentName} ${formatMatchKeyMetric(key.metric, key.opponentValue)}.`}
                    </p>
                    <p className="insight-tactic">{key.advice}</p>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
