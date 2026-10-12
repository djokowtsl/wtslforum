'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = {
  commentId: number;
  initialBody: string;
  canEdit: boolean;
  canDelete: boolean;
};

export default function EditableArticleComment({ commentId, initialBody, canEdit, canDelete }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(initialBody);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/article-comments/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || 'Unable to update the comment.');
      } else {
        setEditing(false);
        router.refresh();
      }
    } catch {
      setError('Network problem — please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Remove this comment?')) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/article-comments/${commentId}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || 'Unable to remove the comment.');
      } else {
        router.refresh();
      }
    } catch {
      setError('Network problem — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="article-comment-edit">
        <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={10000} rows={4} aria-label="Edit your comment" />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="article-comment-actions">
          <button className="btn btn-sm btn-primary" type="button" onClick={save} disabled={busy || !body.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setEditing(false); setBody(initialBody); setError(''); }} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="article-comment-actions">
      {canEdit && <button className="btn btn-sm btn-ghost" type="button" onClick={() => setEditing(true)} disabled={busy}>Edit</button>}
      {canDelete && <button className="btn btn-sm btn-ghost" type="button" onClick={remove} disabled={busy}>Remove</button>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
