'use client';

import { useState } from 'react';
import { FORUM_ROLE_LABELS, type ForumRoleRequest } from '@/lib/forumRoles';

export default function AdminCommunityRoleQueue({
  initialRequests,
}: {
  initialRequests: ForumRoleRequest[];
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  async function review(requestId: number, decision: 'approved' | 'rejected') {
    setBusyId(requestId);
    setMessage('');
    try {
      const response = await fetch('/api/admin/roles/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, decision }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.error || 'Unable to review this request.');
        return;
      }
      setRequests((current) => current.filter((request) => request.id !== requestId));
      setMessage(`Role request ${decision}.`);
    } catch {
      setMessage('Network problem — please try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="community-role-review">
      <h2 className="display">Community role requests</h2>
      <p>Approve or reject member requests for verified profile tags.</p>
      {!requests.length ? (
        <p className="notice">No pending community role requests.</p>
      ) : requests.map((request) => (
        <article className="community-role-review-item" key={request.id}>
          <div>
            <strong>{request.username}</strong>
            <small>Discord ID {request.discord_id} · {FORUM_ROLE_LABELS[request.role_key]}</small>
            <small>Requested {new Date(request.requested_at).toLocaleString('en-GB')}</small>
          </div>
          <div className="community-role-review-actions">
            <button
              className="btn btn-sm"
              type="button"
              disabled={busyId !== null}
              onClick={() => review(request.id, 'approved')}
            >
              {busyId === request.id ? 'Saving…' : 'Approve'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={busyId !== null}
              onClick={() => review(request.id, 'rejected')}
            >
              Reject
            </button>
          </div>
        </article>
      ))}
      {message && <p className="notice" role="status" aria-live="polite">{message}</p>}
    </section>
  );
}
