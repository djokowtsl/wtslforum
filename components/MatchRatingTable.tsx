'use client';

import { useMemo, useState } from 'react';

type Row = { player: string; playerId: string; matches: number; value: number };
type SortKey = 'player' | 'matches' | 'value';

export default function MatchRatingTable({ tour, label, rows }: { tour: string; label: string; rows: Row[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('player');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const compare = sortKey === 'player'
      ? a.player.localeCompare(b.player)
      : a[sortKey] - b[sortKey];
    return sortDir === 'asc' ? compare : -compare;
  }), [rows, sortDir, sortKey]);
  const toggle = (key: SortKey) => {
    if (key === sortKey) setSortDir((direction) => direction === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir(key === 'player' ? 'asc' : 'desc');
    }
  };
  const heading = (label: string, key: SortKey) => (
    <th onClick={() => toggle(key)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return <section className="panel">
    <div className="panel-head"><h2 className="display">{label}</h2></div>
    <div className="table-scroll"><table>
      <thead><tr>{heading('Player', 'player')}{heading('Screenshots', 'matches')}{heading('Rating', 'value')}</tr></thead>
      <tbody>{sorted.map((row) => <tr key={row.playerId}>
        <td><a className="player-line" href={`/players/${row.playerId}?tour=${encodeURIComponent(tour)}`}><span>{row.player}</span></a></td>
        <td>{row.matches}</td><td>{Math.round(row.value)}</td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
