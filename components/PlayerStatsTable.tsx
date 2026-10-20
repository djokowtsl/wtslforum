'use client';
import { useMemo, useState } from 'react';
import RatingEvidence from '@/components/RatingEvidence';
import MetricSampleEvidence from '@/components/MetricSampleEvidence';
import PlayerAvatar from '@/components/PlayerAvatar';
import type { BotRating } from '@/lib/botRatingMetrics';
import {
  FORUM_LEADERBOARD_METRICS,
  type ForumLeaderboardMetricDefinition,
} from '@/lib/forumLeaderboardMetrics';
import { formatLeaderboardMetric } from '@/lib/leaderboardTourAverage.mjs';

type Row = {
  wtsl_player_id: string;
  name: string;
  country?: string | null;
  avatar_url?: string | null;
  flag_url?: string | null;
  matches: number;
  losses: number;
  metricValues: Record<string, number | null>;
  metricSampleCounts: Record<string, number>;
  rating_component_counts?: Record<string, number>;
};

type Column = {
  key: string;
  label: string;
  field?: 'name' | 'matches' | 'losses';
  metric?: ForumLeaderboardMetricDefinition;
};

const COLUMNS: Column[] = [
  { key: 'name', label: 'Player', field: 'name' },
  { key: 'matches', label: 'Matches', field: 'matches' },
  { key: 'losses', label: 'Losses', field: 'losses' },
  ...FORUM_LEADERBOARD_METRICS.map((metric) => ({
    key: `metric:${metric.key}`,
    label: metric.label,
    metric,
  })),
];

function sortValue(row: Row, key: string): string | number | null {
  const column = COLUMNS.find((item) => item.key === key);
  if (!column) return null;
  if (column.metric) return row.metricValues[column.metric.key] ?? null;
  return column.field ? row[column.field] : null;
}

export default function PlayerStatsTable({ rows, tour }: { rows: Row[]; tour: string }) {
  // Defaults to alphabetical (name, ascending) — the Statistics page is the A-Z roster view;
  // clicking a column header re-sorts client-side without a page reload or losing scroll position.
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function toggleSort(key: string) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Numeric columns are more useful sorted high-to-low by default; name stays A-Z first.
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

  function chooseSortKey(key: string) {
    setSortKey(key);
    setSortDir(key === 'name' ? 'asc' : 'desc');
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
      if (bv === null || bv === undefined) return -1;
      let cmp: number;
      if (typeof av === 'string' || typeof bv === 'string') {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      } else {
        cmp = Number(av) - Number(bv);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  return (
    <>
      <div className="player-stats-mobile-sort">
        <label htmlFor="player-stats-sort">Sort by</label>
        <select
          id="player-stats-sort"
          value={sortKey}
          onChange={(event) => chooseSortKey(event.target.value)}
        >
          {COLUMNS.map((column) => (
            <option key={column.key} value={column.key}>
              {column.metric
                ? `${column.label} · ${column.metric.source === 'official' ? 'Official' : 'Screenshot'}`
                : column.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'))}
          aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}
          title={`Currently sorted ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
        >
          {sortDir === 'asc' ? '↑' : '↓'}
        </button>
      </div>
      <div className="table-scroll player-stats-table-scroll">
      <table className="player-stats-table player-stats-table--wide">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                onClick={() => toggleSort(c.key)}
                title={c.metric ? (c.metric.source === 'official' ? 'Official WTSL results' : 'Screenshot statistics') : undefined}
                style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
              >
                {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                {c.metric && <small className="player-stats-source">{c.metric.source === 'official' ? 'Official' : 'Screenshot'}</small>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.wtsl_player_id}>
              <td data-label="Player"><a className="player-line" href={`/players/${p.wtsl_player_id}?tour=${encodeURIComponent(tour)}`}><PlayerAvatar src={p.avatar_url} flagSrc={p.flag_url} flagLabel={p.country} name={p.name} size={34} /><span>{p.name}<small>{p.country || ''}</small></span></a></td>
              <td data-label="Matches"><span className="player-stats-value">{p.matches}</span></td>
              <td data-label="Losses"><span className="player-stats-value">{p.losses}</span></td>
              {FORUM_LEADERBOARD_METRICS.map((metric) => {
                const rawValue = p.metricValues[metric.key];
                const value = formatLeaderboardMetric(rawValue, metric.valueFormat);
                const sampleCount = p.metricSampleCounts[metric.key];
                const metricLabel = `${metric.label} · ${metric.source === 'official' ? 'Official' : 'Screenshot'}`;
                return (
                  <td data-label={metricLabel} key={metric.key}>
                    <span className="player-stats-value">{value}</span>
                    {metric.source === 'screenshot' && metric.valueFormat === 'rating' && rawValue !== null && rawValue !== undefined
                      ? <RatingEvidence metric={metric.key as BotRating} counts={p.rating_component_counts} />
                      : metric.source === 'screenshot' && sampleCount !== undefined
                        ? <MetricSampleEvidence metricLabel={metric.label} sampleCount={sampleCount} />
                        : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
