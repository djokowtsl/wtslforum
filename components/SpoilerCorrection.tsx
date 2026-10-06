'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SpoilerCorrection({ kind, id, body }: { kind: 'topic' | 'reply'; id: number; body: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/moderation/spoilers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, body: draft }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(result.error || 'Unable to save spoiler corrections.'); return; }
      setEditing(false);
      router.refresh();
    } catch {
      setMessage('Network problem — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="spoiler-correction">
      {editing ? (
        <form onSubmit={save}>
          <label>
            Correct spoiler markers only
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={5} maxLength={20000} required />
          </label>
          <p className="notice">Wrap only the passage to conceal in double vertical bars, like ||match result||. The words themselves must stay unchanged.</p>
          <div className="reply-edit-actions">
            <button className="btn btn-sm btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save correction'}</button>
            <button className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={() => { setDraft(body); setEditing(false); setMessage(''); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setDraft(body); setEditing(true); }}>Correct spoiler markers</button>
      )}
      {message && <p className="form-error" role="alert">{message}</p>}
    </div>
  );
}