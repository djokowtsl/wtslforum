'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

export default function EditableReply({
  replyId, body: initialBody, canEdit, canDelete, createdAt, updatedAt, children,
}: {
  replyId: number;
  body: string;
  canEdit: boolean;
  canDelete: boolean;
  createdAt: string;
  updatedAt: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [draft, setDraft] = useState(initialBody);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wasEdited = Date.parse(updatedAt) > Date.parse(createdAt);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextBody = draft.trim();
    if (!nextBody) { setError('A comment cannot be empty.'); return; }
    if (nextBody.length > 10000) { setError('Comments must be 10,000 characters or fewer.'); return; }

    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/replies/${replyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: nextBody }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.error || 'Unable to save your comment.'); return; }
      setBody(nextBody);
      setEditing(false);
      router.refresh();
    } catch {
      setError('Network problem — please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this comment? This cannot be undone.')) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/replies/${replyId}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.error || 'Unable to delete this comment.'); return; }
      router.refresh();
    } catch {
      setError('Network problem — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="post-content">
      <div className="post-date">
        {new Date(createdAt).toLocaleString()} {wasEdited && <span className="reply-edited">· edited</span>}
      </div>
      {editing ? (
        <form className="reply-edit-form" onSubmit={save}>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={10000} rows={6} required aria-label="Edit your comment" />
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="reply-edit-actions">
            <button className="btn btn-sm btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
            <button className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={() => { setDraft(body); setEditing(false); setError(''); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          {children}
          {(canEdit || canDelete) && (
            <div className="reply-edit-actions">
              {canEdit && <button className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={() => { setDraft(body); setError(''); setEditing(true); }}>Edit</button>}
              {canDelete && <button className="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={remove}>Delete</button>}
            </div>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}
