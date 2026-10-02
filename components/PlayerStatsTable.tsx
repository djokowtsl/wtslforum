'use client';
import { useMemo, useState } from 'react';
import RatingEvidence from '@/components/RatingEvidence';

type Row = {
  wtsl_player_id: string;
  name: string;
  country?: string | null;
  avatar_url?: string | null;
  matches: number;
  wins: number;
  losses: number;
  win_pct: number;
  tour_elo: number | null;
  serve_rating?: number | null;
  return_rating?: number | null;
  pressure_rating?: number | null;
  rating_component_counts?: Record<string, number>;
};

const COLUMNS: { key: keyof Row; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Player' },
  { key: 'matches', label: 'Screenshots', numeric: true },
  { key: 'wins', label: 'W', numeric: true },
  { key: 'losses', label: 'L', numeric: true },
  { key: 'win_pct', label: 'Win %', numeric: true },
  { key: 'tour_elo', label: 'Tour Elo', numeric: true },
  { key: 'serve_rating', label: 'Serve', numeric: true },
  { key: 'return_rating', label: 'Return', numeric: true },
  { key: 'pressure_rating', label: 'Under pressure', numeric: true },
];

export default function PlayerStatsTable({ rows, tour }: { rows: Row[]; tour: string }) {
  // Defaults to alphabetical (name, ascending) — the Statistics page is the A-Z roster view;
  // clicking a column header re-sorts client-side without a page reload or losing scroll position.
  const [sortKey, setSortKey] = useState<keyof Row>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function toggleSort(key: keyof Row) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Numeric columns are more useful sorted high-to-low by default; name stays A-Z first.
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  }

  function chooseSortKey(key: keyof Row) {
    setSortKey(key);
    setSortDir(key === 'name' ? 'asc' : 'desc');
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (typeof av === 'string' || typeof bv === 'string') {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      } else {
        cmp = (Number(av) || 0) - (Number(bv) || 0);
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
          onChange={(event) => chooseSortKey(event.target.value as keyof Row)}
        >
          {COLUMNS.map((column) => (
            <option key={column.key} value={column.key}>{column.label}</option>
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
      <table className="player-stats-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} onClick={() => toggleSort(c.key)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
                {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.wtsl_player_id}>
              <td data-label="Player"><a className="player-line" href={`/players/${p.wtsl_player_id}?tour=${encodeURIComponent(tour)}`}>{p.avatar_url && <img src={p.avatar_url} alt="" />}<span>{p.name}<small>{p.country || ''}</small></span></a></td>
              <td data-label="Screenshots"><span className="player-stats-value">{p.matches}</span></td>
              <td data-label="Wins"><span className="player-stats-value">{p.wins}</span></td>
              <td data-label="Losses"><span className="player-stats-value">{p.losses}</span></td>
              <td data-label="Win %"><span className="player-stats-value">{p.win_pct}%</span></td>
              <td data-label="Tour Elo"><span className="player-stats-value">{p.tour_elo ?? '—'}</span></td>
              <td data-label="Serve">
                <span className="player-stats-value">{p.serve_rating == null ? '—' : p.serve_rating.toFixed(1)}</span>
                {p.serve_rating != null && <RatingEvidence metric="serve" counts={p.rating_component_counts} />}
              </td>
              <td data-label="Return">
                <span className="player-stats-value">{p.return_rating == null ? '—' : p.return_rating.toFixed(1)}</span>
                {p.return_rating != null && <RatingEvidence metric="return" counts={p.rating_component_counts} />}
              </td>
              <td data-label="Under pressure">
                <span className="player-stats-value">{p.pressure_rating == null ? '—' : p.pressure_rating.toFixed(1)}</span>
                {p.pressure_rating != null && <RatingEvidence metric="pressure" counts={p.rating_component_counts} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
