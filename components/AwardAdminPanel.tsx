'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Nominee = { id: number; name: string; note: string };
type Category = { id: number; name: string; slug: string; allow_write_in: boolean; nominees: Nominee[]; tally: { name: string; votes: number }[]; write_ins: { write_in: string; votes: number }[] };

export default function AwardAdminPanel({ cycleId, votingOpen, categories }: { cycleId: number; votingOpen: boolean; categories: Category[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [newNominee, setNewNominee] = useState<Record<number, string>>({});
  const [csv, setCsv] = useState<Record<number, string>>({});
  const [err, setErr] = useState('');

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/admin/awards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-card">
      <h3>Awards voting</h3>
      <p className="notice" style={{ marginBottom: 14 }}>
        Voting is currently <b>{votingOpen ? 'OPEN' : 'closed'}</b>. Add nominees for each award below, then open voting when you&apos;re ready. Google Form rows can be imported as one-vote-per-line CSV: <code>handle,nominee name</code> (or a write-in instead of a nominee name).
      </p>
      {err && <div className="notice" style={{ borderColor: '#ffb3bb', marginBottom: 14 }}>{err}</div>}
      <button className="btn btn-sm" disabled={busy} onClick={() => call({ action: 'toggle-voting', cycleId, open: !votingOpen })}>
        {votingOpen ? 'Close voting' : 'Open voting'}
      </button>

      <div style={{ display: 'grid', gap: 18, marginTop: 20 }}>
        {categories.map((c) => (
          <div key={c.id} className="forum-list" style={{ padding: 16 }}>
            <strong>{c.name}</strong>
            <ul style={{ margin: '10px 0', paddingLeft: 18 }}>
              {c.nominees.map((n) => (
                <li key={n.id} style={{ marginBottom: 4 }}>
                  {n.name}
                  <button className="btn btn-sm btn-ghost" style={{ marginLeft: 10, padding: '2px 8px' }} disabled={busy} onClick={() => call({ action: 'remove-nominee', nomineeId: n.id })}>Remove</button>
                </li>
              ))}
              {c.nominees.length === 0 && <li style={{ color: 'var(--muted)' }}>No nominees yet.</li>}
            </ul>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                placeholder="Nominee name"
                value={newNominee[c.id] ?? ''}
                onChange={(e) => setNewNominee((s) => ({ ...s, [c.id]: e.target.value }))}
                style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text)' }}
              />
              <button className="btn btn-sm" disabled={busy || !newNominee[c.id]?.trim()} onClick={() => { call({ action: 'add-nominee', categoryId: c.id, name: newNominee[c.id] }); setNewNominee((s) => ({ ...s, [c.id]: '' })); }}>Add</button>
            </div>
            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--soft)', fontSize: 13 }}>Import Google Form CSV / view tally ({c.tally.reduce((a, t) => a + t.votes, 0) + c.write_ins.reduce((a, w) => a + w.votes, 0)} votes)</summary>
              <div style={{ marginTop: 10 }}>
                {c.tally.filter((t) => t.votes > 0).map((t) => <div key={t.name}>{t.name}: <b>{t.votes}</b></div>)}
                {c.write_ins.map((w) => <div key={w.write_in}>“{w.write_in}” (write-in): <b>{w.votes}</b></div>)}
                <textarea
                  placeholder="handle,nominee name"
                  value={csv[c.id] ?? ''}
                  onChange={(e) => setCsv((s) => ({ ...s, [c.id]: e.target.value }))}
                  style={{ width: '100%', minHeight: 70, marginTop: 10, padding: 8, borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text)' }}
                />
                <button className="btn btn-sm" disabled={busy || !csv[c.id]?.trim()} onClick={() => call({ action: 'import-csv', categoryId: c.id, csv: csv[c.id] })} style={{ marginTop: 8 }}>Import</button>
              </div>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
