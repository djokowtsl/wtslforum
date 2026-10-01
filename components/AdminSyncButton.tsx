'use client';
import { useState } from 'react';

// Keep this in sync with lib/wtsl.ts TOURS — duplicated as plain data so this client
// component doesn't need to bundle the server-side scraping module.
const TOURS: { code: string; label: string }[] = [
  { code: 'TE4', label: 'ATP' },
  { code: 'TE4_(F)', label: 'WTA' },
  { code: 'TE4_CD', label: 'Doubles' },
  { code: 'TE4_Coop', label: 'Coop' },
  { code: 'TE4_P', label: 'Created' },
];
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'players', label: 'Players' },
  { key: 'tournaments', label: 'Tournaments' },
  { key: 'playerStats', label: 'Player stats' },
];

type TourResult = { tour?: string; error?: string; seen?: number; upserted?: number; created?: number; updated?: number; failed?: number; lastError?: string };

function summarize(tourLabel: string, result: TourResult | undefined): string {
  if (!result) return `${tourLabel}: no result`;
  if (result.error) return `${tourLabel} failed (${result.error})`;
  // `upserted` is the real "how many actually wrote to the DB" count for player/stat syncs.
  // Tournaments report `created`/`updated` instead. Checking `!== undefined` (not `??`/`||`)
  // matters: a genuine 0 upserted (every row failed to write, e.g. a missing DB column) must
  // stay 0 and not silently fall back to `seen`, which used to make a total failure look
  // identical to a full success in this log.
  const count = result.upserted !== undefined ? result.upserted : (result.created ?? 0) + (result.updated ?? 0) || result.seen || 0;
  const seen = result.seen ?? 0;
  const failed = result.failed ?? (seen && result.upserted !== undefined ? Math.max(seen - result.upserted, 0) : 0);
  let line = `${tourLabel}: ${count}${seen ? ` / ${seen}` : ''}`;
  if (failed > 0) line += ` (${failed} failed${result.lastError ? `: ${result.lastError}` : ''})`;
  return line;
}

export default function AdminSyncButton() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [lines, setLines] = useState<string[]>([]);

  // Runs 15 small requests (5 tours x 3 categories) one at a time instead of one giant
  // request. Scraping every player's profile across every tour in a single serverless
  // invocation easily exceeds Vercel's function time limit, which used to kill the whole sync
  // mid-way and show a generic "check your connection" error with nothing to show for it.
  // Doing it in small steps means each request finishes quickly, a single slow/failing
  // tour can't block the rest, and the admin sees real progress as it goes.
  async function run() {
    setState('running');
    setLines([]);
    let anyError = false;
    for (const cat of CATEGORIES) {
      setLines((prev) => [...prev, `— ${cat.label} —`]);
      for (const t of TOURS) {
        try {
          const r = await fetch('/api/admin/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ category: cat.key, tour: t.code }),
          });
          const data = await r.json();
          if (!data.ok) anyError = true;
          setLines((prev) => [...prev, summarize(t.label, data.result)]);
        } catch {
          anyError = true;
          setLines((prev) => [...prev, `${t.label} failed (request error — check your connection)`]);
        }
      }
    }
    setState(anyError ? 'error' : 'done');
  }

  return (
    <div>
      <button className="btn btn-sm" onClick={run} disabled={state === 'running'}>
        {state === 'running' ? 'Syncing…' : 'Run sync now'}
      </button>
      {lines.length > 0 && (
        <div className="notice" style={{ marginTop: 10 }}>
          {state === 'error' && <p><strong>Sync finished with errors:</strong></p>}
          {state === 'done' && <p><strong>Sync complete.</strong></p>}
          {lines.map((l, i) => <p key={i} style={{ margin: '4px 0' }}>{l}</p>)}
        </div>
      )}
    </div>
  );
}
