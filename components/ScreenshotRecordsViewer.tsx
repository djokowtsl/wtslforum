'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { SCREENSHOT_METRIC_FIELDS, SCREENSHOT_RECORD_FIELDS } from '@/lib/screenshotRecordFields';
import SearchableDropdown from '@/components/SearchableDropdown';
import type { ScreenshotStatsTour } from '@/lib/screenshotStatsQuestions';

type Filters = {
  tour: ScreenshotStatsTour;
  player: string;
  opponent: string;
  tournament: string;
  year: string;
  status: string;
  search: string;
  metric: string;
  min: string;
  max: string;
};

type ScreenshotRecord = {
  recordId: string;
  playerName: string;
  opponentName: string;
  tournamentName: string;
  date: string;
  score: string;
  reviewStatus: string;
  data: Record<string, string | number>;
};

type PageResult = {
  records: ScreenshotRecord[];
  total: number;
  page: number;
  pageSize: number;
  rankingListAvailable: boolean;
};

type FilterOptions = {
  players: string[];
  opponents: string[];
  tournaments: string[];
  years: string[];
  rankingListAvailable?: boolean;
};

const EMPTY_FILTER_OPTIONS: FilterOptions = {
  players: [],
  opponents: [],
  tournaments: [],
  years: [],
};

const EMPTY_RESULT: PageResult = {
  records: [],
  total: 0,
  page: 1,
  pageSize: 50,
  rankingListAvailable: true,
};

function initialFilters(tour: ScreenshotStatsTour): Filters {
  return {
    tour,
    player: '',
    opponent: '',
    tournament: '',
    year: '',
    status: 'any',
    search: '',
    metric: '',
    min: '',
    max: '',
  };
}

function statusClass(status: string) {
  if (status === 'FOR REVIEW') return 'screenshot-record-status--review';
  if (status === 'DUPLICATE') return 'screenshot-record-status--duplicate';
  if (status === 'DAVIS CUP') return 'screenshot-record-status--event';
  return '';
}

export default function ScreenshotRecordsViewer({
  initialTour,
  initialResult,
  initialFilterOptions,
  initialLoadError = false,
  initialOptionsError = false,
}: {
  initialTour: ScreenshotStatsTour;
  initialResult?: PageResult;
  initialFilterOptions?: FilterOptions;
  initialLoadError?: boolean;
  initialOptionsError?: boolean;
}) {
  const [draft, setDraft] = useState<Filters>(() => initialFilters(initialTour));
  const [applied, setApplied] = useState<Filters>(() => initialFilters(initialTour));
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PageResult>(initialResult ?? EMPTY_RESULT);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(initialFilterOptions ?? EMPTY_FILTER_OPTIONS);
  const [optionsLoading, setOptionsLoading] = useState(!initialFilterOptions);
  const [optionsError, setOptionsError] = useState(initialOptionsError ? 'Search suggestions could not be loaded. You can still type a value.' : '');
  const [loading, setLoading] = useState(!initialResult);
  const [error, setError] = useState(initialLoadError ? 'Screenshot rows could not be loaded. Please try again.' : '');

  useEffect(() => {
    const controller = new AbortController();

    async function loadFilterOptions() {
      setOptionsLoading(true);
      setOptionsError('');
      try {
        const response = await fetch('/api/screenshot-records/options?tour=' + encodeURIComponent(draft.tour), {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Request failed');
        const options = await response.json() as FilterOptions;
        if (
          !Array.isArray(options.players)
          || !Array.isArray(options.opponents)
          || !Array.isArray(options.tournaments)
          || !Array.isArray(options.years)
        ) throw new Error('Invalid filter options');
        setFilterOptions(options);
      } catch {
        if (!controller.signal.aborted) {
          setFilterOptions(EMPTY_FILTER_OPTIONS);
          setOptionsError('Search suggestions could not be loaded. You can still type a value.');
        }
      } finally {
        if (!controller.signal.aborted) setOptionsLoading(false);
      }
    }

    void loadFilterOptions();
    return () => controller.abort();
  }, [draft.tour]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      tour: applied.tour,
      page: String(page),
      player: applied.player,
      opponent: applied.opponent,
      tournament: applied.tournament,
      year: applied.year,
      status: applied.status,
      q: applied.search,
      metric: applied.metric,
      min: applied.min,
      max: applied.max,
      rankedOnly: 'true',
    });

    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/screenshot-records?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Request failed');
        setResult(await response.json() as PageResult);
      } catch {
        if (!controller.signal.aborted) {
          setError('Screenshot rows could not be loaded. Please try again.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [applied, page]);

  function change<K extends keyof Filters>(key: K, value: Filters[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(1);
    setApplied({ ...draft });
  }

  function resetFilters() {
    const fresh = initialFilters(initialTour);
    setDraft(fresh);
    setPage(1);
    setApplied(fresh);
  }

  const firstRow = result.total === 0 ? 0 : (page - 1) * result.pageSize + 1;
  const lastRow = Math.min(page * result.pageSize, result.total);
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <section className="screenshot-records" aria-labelledby="screenshot-records-title">
      <div className="screenshot-records-heading">
        <div>
          <span className="screenshot-explorer-kicker">WTSL Data Store</span>
          <h2 id="screenshot-records-title">Individual screenshot rows</h2>
          <p>Search match records from the ATP and WTA screenshots database. Only rows where the player matches an official name from the WTSL rankings are displayed.</p>
        </div>
        <div className="screenshot-records-count" aria-live="polite">
          <strong>{error ? '—' : result.total.toLocaleString()}</strong>
          <span>matching rows</span>
        </div>
      </div>

      <form className="screenshot-records-filters" onSubmit={applyFilters}>
        <label className="screenshot-record-filter">
          <span>Tour</span>
          <select value={draft.tour} onChange={(event) => change('tour', event.target.value as ScreenshotStatsTour)}>
            <option value="TE4">ATP</option>
            <option value="TE4_(F)">WTA</option>
          </select>
        </label>
        <div className="screenshot-record-filter">
          <label htmlFor="screenshot-player-filter">Player (exact)</label>
          <SearchableDropdown
            id="screenshot-player-filter"
            options={filterOptions.players}
            value={draft.player}
            onChange={(value) => change('player', value)}
            placeholder="Search player names"
            loading={optionsLoading}
          />
        </div>
        <div className="screenshot-record-filter">
          <label htmlFor="screenshot-opponent-filter">Opponent (exact)</label>
          <SearchableDropdown
            id="screenshot-opponent-filter"
            options={filterOptions.opponents}
            value={draft.opponent}
            onChange={(value) => change('opponent', value)}
            placeholder="Search opponent names"
            loading={optionsLoading}
          />
        </div>
        <div className="screenshot-record-filter">
          <label htmlFor="screenshot-tournament-filter">Tournament</label>
          <SearchableDropdown
            id="screenshot-tournament-filter"
            options={filterOptions.tournaments}
            value={draft.tournament}
            onChange={(value) => change('tournament', value)}
            placeholder="Search tournaments"
            loading={optionsLoading}
          />
        </div>
        <div className="screenshot-record-filter screenshot-record-filter--short">
          <label htmlFor="screenshot-year-filter">Year</label>
          <SearchableDropdown
            id="screenshot-year-filter"
            options={filterOptions.years}
            value={draft.year}
            onChange={(value) => change('year', value.replace(/\D/g, '').slice(0, 4))}
            placeholder="Search years"
            loading={optionsLoading}
          />
        </div>
        <label className="screenshot-record-filter">
          <span>Workbook status</span>
          <select value={draft.status} onChange={(event) => change('status', event.target.value)}>
            <option value="any">Any status</option>
            <option value="unflagged">Unflagged</option>
            <option value="FOR REVIEW">For review</option>
            <option value="DAVIS CUP">Davis Cup</option>
            <option value="DUPLICATE">Duplicate</option>
          </select>
        </label>
        <label className="screenshot-record-filter screenshot-record-filter--wide">
          <span>Search player, opponent, event, score, or date</span>
          <input value={draft.search} onChange={(event) => change('search', event.target.value)} placeholder="Search rows" />
        </label>
        <label className="screenshot-record-filter screenshot-record-filter--wide">
          <span>Statistic</span>
          <select value={draft.metric} onChange={(event) => change('metric', event.target.value)}>
            <option value="">Any statistic</option>
            {SCREENSHOT_METRIC_FIELDS.map((metric) => <option key={metric} value={metric}>{metric}</option>)}
          </select>
        </label>
        <label className="screenshot-record-filter screenshot-record-filter--range">
          <span>Minimum</span>
          <input type="number" step="any" value={draft.min} disabled={!draft.metric} onChange={(event) => change('min', event.target.value)} placeholder="Any" />
        </label>
        <label className="screenshot-record-filter screenshot-record-filter--range">
          <span>Maximum</span>
          <input type="number" step="any" value={draft.max} disabled={!draft.metric} onChange={(event) => change('max', event.target.value)} placeholder="Any" />
        </label>
        <div className="screenshot-record-filter-actions">
          <button className="btn" type="submit">Search rows</button>
          <button className="screenshot-record-reset" type="button" onClick={resetFilters}>Reset</button>
        </div>
      </form>
      {optionsError ? <p className="screenshot-records-options-error" role="status">{optionsError}</p> : null}

      <div className="screenshot-records-summary" aria-live="polite">
        {loading
          ? null
          : error
            ? 'Screenshot rows are temporarily unavailable'
            : result.total
            ? `Showing ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${result.total.toLocaleString()} rows`
            : result.rankingListAvailable
              ? 'No ranked-player rows match these filters'
              : 'Current WTSL rankings are unavailable; screenshot rows are hidden'}
      </div>
      {error ? <p className="screenshot-records-error" role="alert">{error}</p> : null}

      <div className="screenshot-records-table-wrap">
        <table className="screenshot-records-table">
          <thead>
            <tr>
              <th scope="col">Row ID</th>
              <th scope="col">Date</th>
              <th scope="col">Player</th>
              <th scope="col">Opponent</th>
              <th scope="col">Tournament</th>
              <th scope="col">Result</th>
              <th scope="col">Status</th>
              <th scope="col">Full row</th>
            </tr>
          </thead>
          <tbody>
            {result.records.map((record) => (
              <tr key={`${applied.tour}-${record.recordId}`}>
                <td>{String(record.data.ID ?? record.recordId)}</td>
                <td>{record.date || '—'}</td>
                <td>{record.playerName}</td>
                <td>{record.opponentName}</td>
                <td>{record.tournamentName || '—'}</td>
                <td>{record.score}</td>
                <td>
                  <span className={`screenshot-record-status ${statusClass(record.reviewStatus)}`}>
                    {record.reviewStatus || 'Unflagged'}
                  </span>
                </td>
                <td>
                  <details className="screenshot-record-details">
                    <summary>View fields</summary>
                    <dl>
                      {SCREENSHOT_RECORD_FIELDS.map((field) => {
                        const value = record.data[field];
                        if (value === undefined || value === '') return null;
                        return (
                          <div key={field}>
                            <dt>{field}</dt>
                            <dd>{String(value)}</dd>
                          </div>
                        );
                      })}
                    </dl>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="screenshot-records-pagination">
        <button type="button" className="screenshot-record-page-button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          Previous
        </button>
        <span>Page {page} of {pageCount}</span>
        <button type="button" className="screenshot-record-page-button" disabled={page >= pageCount || loading} onClick={() => setPage((current) => current + 1)}>
          Next
        </button>
      </div>
    </section>
  );
}