'use client';
import { useState } from 'react';

type TourResult = { tour: string; error?: string; seen?: number; upserted?: number; created?: number; updated?: number };

function summarizeCategory(label: string, rows: TourResult[] | { error: string } | undefined): string {
  if (!rows) return `${label}: no result`;
  if (!Array.isArray(rows)) return `${label}: ${rows.error}`;
  return rows
    .map((r) => {
      if (r.error) return `${r.tour} failed (${r.error})`;
      const count = (r.upserted ?? ((r.created ?? 0) + (r.updated ?? 0))) || r.seen || 0;
      return `${r.tour}: ${count}`;
    })
    .join(', ');
}

export default function AdminSyncButton() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [lines, setLines] = useState<string[]>([]);

  async function run() {
    setState('running');
    setLines([]);
    try {
      const r = await fetch('/api/admin/sync', { method: 'POST' });
      const data = await r.json();
      const out = [
        summarizeCategory('Players', data.players),
        summarizeCategory('Tournaments', data.tournaments),
        summarizeCategory('Player stats', data.playerStats),
      ];
      setState(data.ok ? 'done' : 'error');
      setLines(out);
    } catch {
      setState('error');
      setLines(['Sync request failed. Check your connection and try again.']);
    }
  }

  return (
    <div>
      <button className="btn btn-sm" onClick={run} disabled={state === 'running'}>
        {state === 'running' ? 'Syncing…' : 'Run sync now'}
      </button>
      {lines.length > 0 && (
        <div className="notice" style={{ marginTop: 10 }}>
          {state === 'error' && <p><strong>Sync finished with errors:</strong></p>}
          {lines.map((l, i) => <p key={i} style={{ margin: '4px 0' }}>{l}</p>)}
        </div>
      )}
    </div>
  );
}
