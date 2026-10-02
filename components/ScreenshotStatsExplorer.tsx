'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  answerScreenshotStatsQuestion,
  type ScreenshotStatsMetric,
  type ScreenshotStatsPopulations,
  type ScreenshotStatsTour,
} from '@/lib/screenshotStatsQuestions';

type ScreenshotStatsExplorerProps = {
  initialTour: ScreenshotStatsTour;
  populations: ScreenshotStatsPopulations;
  metrics: ScreenshotStatsMetric[];
};

type SortMode = 'best' | 'highest' | 'lowest' | 'name';

function formatMetricValue(value: number, metric: ScreenshotStatsMetric): string {
  if (metric.valueFormat === 'percent') {
    const percentage = value >= 0 && value <= 1 ? value * 100 : value;
    return `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(percentage)}%`;
  }
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);
}

export default function ScreenshotStatsExplorer({
  initialTour,
  populations,
  metrics,
}: ScreenshotStatsExplorerProps) {
  const [selectedTour, setSelectedTour] = useState<ScreenshotStatsTour>(initialTour);
  const [selectedSourceLabel, setSelectedSourceLabel] = useState(metrics[0]?.sourceLabel ?? '');
  const [playerSearch, setPlayerSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('best');
  const [question, setQuestion] = useState('');
  const [questionResult, setQuestionResult] = useState<string | null | undefined>(undefined);

  const selectedMetric = metrics.find((metric) => metric.sourceLabel === selectedSourceLabel) ?? metrics[0];
  const visibleRows = useMemo(() => {
    if (!selectedMetric) return [];

    const search = playerSearch.trim().toLocaleLowerCase();
    const rows = (populations[selectedTour] ?? [])
      .filter((row) => Number.isFinite(row.metrics[selectedMetric.sourceLabel]))
      .filter((row) => !search || row.playerName.toLocaleLowerCase().includes(search));

    return rows.sort((left, right) => {
      if (sortMode === 'name') return left.playerName.localeCompare(right.playerName);
      const direction = sortMode === 'best'
        ? selectedMetric.direction
        : sortMode === 'highest' ? 'desc' : 'asc';
      const difference = left.metrics[selectedMetric.sourceLabel] - right.metrics[selectedMetric.sourceLabel];
      return (direction === 'desc' ? -difference : difference)
        || left.playerName.localeCompare(right.playerName);
    });
  }, [playerSearch, populations, selectedMetric, selectedTour, sortMode]);

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuestionResult(
      answerScreenshotStatsQuestion(question, populations, metrics, selectedTour),
    );
  }

  function changeTour(tour: ScreenshotStatsTour) {
    setSelectedTour(tour);
    setQuestionResult(undefined);
  }

  return (
    <section className="screenshot-explorer" aria-label="Screenshot statistics explorer">
      <header className="screenshot-explorer-heading">
        <div>
          <span className="screenshot-explorer-kicker">PLAYER DATA / MATCH ANALYSIS</span>
          <h2>Explore the snapshot</h2>
          <p>Filter reported player values, or ask a question about the published numbers.</p>
        </div>
        <div className="screenshot-explorer-stamp" aria-label="Published snapshot">
          <span className="screenshot-explorer-stamp-mark" aria-hidden="true">W</span>
          <span><b>Published</b><small>reconciled snapshot</small></span>
        </div>
      </header>

      <section className="screenshot-question" aria-labelledby="screenshot-question-title">
        <div className="screenshot-question-intro">
          <span className="screenshot-section-index">01 / ASK</span>
          <div>
            <h3 id="screenshot-question-title">Ask the snapshot</h3>
            <p>Answers are calculated from the published player values. Name ATP or WTA in your question to choose a tour.</p>
          </div>
        </div>
        <form className="screenshot-question-form" onSubmit={submitQuestion}>
          <label htmlFor="screenshot-question-input">Your question</label>
          <div className="screenshot-question-entry">
            <input
              id="screenshot-question-input"
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Who has the most aces?"
              autoComplete="off"
            />
            <button className="btn btn-primary" type="submit">Get answer</button>
          </div>
          <p className="screenshot-question-examples">
            Try highest, lowest or best for a metric; the average; one player’s value; or a comparison between two players.
          </p>
        </form>
        {questionResult !== undefined ? (
          <div className={`screenshot-answer${questionResult === null ? ' is-uninterpreted' : ''}`} role="status" aria-live="polite">
            {questionResult === null ? (
              <p>
                I couldn’t interpret that question. Try asking for the highest, lowest or best metric, an average, one player’s metric, or a comparison between two named players.
              </p>
            ) : (
              <p>{questionResult}</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="screenshot-results" aria-labelledby="screenshot-results-title">
        <div className="screenshot-results-heading">
          <div>
            <span className="screenshot-section-index">02 / EXPLORE</span>
            <h3 id="screenshot-results-title">Player values</h3>
          </div>
        </div>

        <div className="screenshot-controls">
          <fieldset className="screenshot-tour-control">
            <legend>Tour</legend>
            <div className="screenshot-tour-options">
              {([
                ['TE4', 'ATP'],
                ['TE4_(F)', 'WTA'],
              ] as const).map(([tour, label]) => (
                <button
                  key={tour}
                  type="button"
                  className={`screenshot-tour-button${selectedTour === tour ? ' is-selected' : ''}`}
                  aria-pressed={selectedTour === tour}
                  onClick={() => changeTour(tour)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="screenshot-control" htmlFor="screenshot-metric">
            <span>Metric</span>
            <select
              id="screenshot-metric"
              value={selectedMetric?.sourceLabel ?? ''}
              onChange={(event) => setSelectedSourceLabel(event.target.value)}
              disabled={!metrics.length}
            >
              {metrics.length ? metrics.map((metric) => (
                <option key={metric.sourceLabel} value={metric.sourceLabel}>{metric.label}</option>
              )) : <option value="">No metrics available</option>}
            </select>
          </label>

          <label className="screenshot-control screenshot-search-control" htmlFor="screenshot-player-search">
            <span>Search players</span>
            <input
              id="screenshot-player-search"
              type="search"
              value={playerSearch}
              onChange={(event) => setPlayerSearch(event.target.value)}
              placeholder="Player name"
              autoComplete="off"
            />
          </label>

          <label className="screenshot-control" htmlFor="screenshot-sort">
            <span>Sort values</span>
            <select
              id="screenshot-sort"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
            >
              <option value="best">Best by metric</option>
              <option value="highest">Highest value</option>
              <option value="lowest">Lowest value</option>
              <option value="name">Player name, A–Z</option>
            </select>
          </label>
        </div>

        {!selectedMetric ? (
          <div className="screenshot-empty" role="status">
            <strong>No metrics are available</strong>
            <p>There are no published statistics to explore right now.</p>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="screenshot-empty" role="status">
            <strong>{playerSearch.trim() ? 'No players match that search' : 'No reported values for this metric'}</strong>
            <p>{playerSearch.trim() ? 'Try another spelling or clear the player search.' : 'Choose another metric to explore the values available in this snapshot.'}</p>
          </div>
        ) : (
          <div className="screenshot-table-wrap">
            <table className="screenshot-table">
              <caption className="screenshot-visually-hidden">
                {selectedTour === 'TE4' ? 'ATP' : 'WTA'} player values for {selectedMetric.label}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="screenshot-rank-heading">#</th>
                  <th scope="col">Player</th>
                  <th scope="col" className="screenshot-value-heading">{selectedMetric.label}</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={row.playerName}>
                    <td className="screenshot-rank">{String(index + 1).padStart(2, '0')}</td>
                    <th scope="row">{row.playerName}</th>
                    <td className="screenshot-value">{formatMetricValue(row.metrics[selectedMetric.sourceLabel], selectedMetric)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="screenshot-explorer-source">Results are computed from the reconciled published snapshot.</p>
      </section>
    </section>
  );
}