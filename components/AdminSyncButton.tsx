'use client';
import { useState } from 'react';

export default function AdminSyncButton() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [summary, setSummary] = useState<string>('');

  async function run() {
    setState('running');
    setSummary('');
    try {
      const r = await fetch('/api/admin/sync', { method: 'POST' });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setState('error');
        setSummary(data.error || 'Sync finished with errors — check server logs.');
        return;
      }
      setState('done');
      setSummary('Players, tournaments and player stats synced from the official WTSL site.');
    } catch {
      setState('error');
      setSummary('Sync request failed. Check your connection and try again.');
    }
  }

  return (
    <div>
      <button className="btn btn-sm" onClick={run} disabled={state === 'running'}>
        {state === 'running' ? 'Syncing…' : 'Run sync now'}
      </button>
      {summary && (
        <p className="notice" style={{ marginTop: 10 }}>{summary}</p>
      )}
    </div>
  );
}
