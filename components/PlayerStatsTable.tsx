'use client';
import { useMemo, useState } from 'react';

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
};

const COLUMNS: { key: keyof Row; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Player' },
  { key: 'matches', label: 'Screenshots', numeric: true },
  { key: 'wins', label: 'W', numeric: true },
  { key: 'losses', label: 'L', numeric: true },
  { key: 'win_pct', label: 'Win %', numeric: true },
  { key: 'tour_elo', label: 'Tour Elo', numeric: true },
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
    <div className="table-scroll">
      <table>
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
              <td><a className="player-line" href={`/players/${p.wtsl_player_id}?tour=${encodeURIComponent(tour)}`}>{p.avatar_url && <img src={p.avatar_url} alt="" />}<span>{p.name}<small>{p.country || ''}</small></span></a></td>
              <td>{p.matches}</td><td>{p.wins}</td><td>{p.losses}</td><td>{p.win_pct}%</td><td>{p.tour_elo ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
