import {
  buildWtaProfileStatLines,
  type WtaProfileScreenshotStats,
} from '@/lib/wtaProfileStatistics';

export default function WtaProfileMatchStatistics({
  snapshot,
  unavailable = false,
}: {
  snapshot: WtaProfileScreenshotStats | null;
  unavailable?: boolean;
}) {
  const lines = buildWtaProfileStatLines(snapshot);
  return (
    <section className="panel" aria-label="WTA screenshot-derived match statistics">
      <div className="panel-head">
        <h2 className="display">Match Statistics</h2>
        <span
          className="pill cyan"
          title="WTA averages from eligible screenshot matches, not official WTSL profile averages. This is the available screenshot sample, not a complete career record. Each statistic uses only matches with that measurement; percentages are per-match averages."
        >Screenshot-derived</span>
      </div>
      {unavailable ? (
        <p role="status">Screenshot statistics are temporarily unavailable. Please try again later.</p>
      ) : !snapshot ? (
        <p>No eligible WTA screenshot statistics are available for this player yet.</p>
      ) : null}
      <div className="player-stat-grid">
        {lines.map((line) => (
          <div key={line.label}>
            <small>{line.label}</small>
            <strong>{line.value}</strong>
            <span className="player-stat-sample">
              {line.sampleCount === null
                ? 'No supported samples'
                : `${line.sampleCount} ${line.sampleCount === 1 ? 'match' : 'matches'}`}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
