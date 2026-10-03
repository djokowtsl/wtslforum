'use client';
import { useState } from 'react';
import MentionTextarea from './MentionTextarea';

export default function ReplyForm({ topicId }: { topicId: number }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingMessage, setPendingMessage] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setPendingMessage('');
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch('/api/replies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId, body: f.get('body') }) });
      const x = await r.json().catch(() => ({}));
      if (r.ok && x.pending) setPendingMessage(x.message || 'Your reply is waiting for moderator review.');
      else if (r.ok) location.reload();
      else setError(x.error || 'Unable to post your reply.');
    } catch {
      setError('Network problem — please try again.');
    }
    setBusy(false);
  }

  return (
    <form className="form-card" onSubmit={submit}>
      <label>
        Your reply
        <MentionTextarea name="body" rows={6} required maxLength={10000} placeholder="Join the discussion…" enableSpoilers />
      </label>
      {error && <p className="form-error">{error}</p>}
      {pendingMessage && <p className="notice" role="status">{pendingMessage}</p>}
      <div><button className="btn btn-primary" type="submit" disabled={busy || !!pendingMessage}>{busy ? 'Posting…' : pendingMessage ? 'Awaiting review' : 'Post reply'}</button></div>
    </form>
  );
}
