'use client';
import { useState, useTransition } from 'react';

export type AdminClaim = {
  id: string;
  username: string;
  discord_id: string;
  wtsl_player_id: string;
  tour: string;
  player_name: string;
  note: string;
  created_at: string;
};

export default function ClaimAdminPanel({ claims }: { claims: AdminClaim[] }) {
  const [rows, setRows] = useState(claims);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>('');

  function act(claimId: string, action: 'approve' | 'reject') {
    setError('');
    start(async () => {
      const r = await fetch('/api/admin/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: claimId, action }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setError(data.error || 'Could not update claim');
        return;
      }
      setRows((prev) => prev.filter((c) => c.id !== claimId));
    });
  }

  if (rows.length === 0) return <div className="empty">No pending player verification requests.</div>;

  return (
    <div>
      {error && <p className="notice" style={{ color: '#ff6b6b' }}>{error}</p>}
      <table className="panel-table">
        <thead>
          <tr><th>Discord account</th><th>Claims to be</th><th>Note</th><th>Submitted</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{c.username}</td>
              <td>{c.player_name} <small>({c.tour} · ID {c.wtsl_player_id})</small></td>
              <td>{c.note || '—'}</td>
              <td>{new Date(c.created_at).toLocaleDateString()}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn btn-sm" disabled={pending} onClick={() => act(c.id, 'approve')}>Approve</button>{' '}
                <button className="btn btn-sm" disabled={pending} onClick={() => act(c.id, 'reject')}>Reject</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
