'use client';

import { useState } from 'react';
import MentionTextarea from '@/components/MentionTextarea';

export default function ArticleCommentForm({ articleId }: { articleId: number }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingMessage, setPendingMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setPendingMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/articles/${articleId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: form.get('body') }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 202 && result.pending) {
        setPendingMessage(result.message || 'Your comment is waiting for moderator review.');
      } else if (response.ok) {
        window.location.reload();
      } else {
        setError(result.error || 'Unable to post your comment.');
      }
    } catch {
      setError('Network problem — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-card article-comment-form" onSubmit={submit}>
      <label>
        Add a comment
        <MentionTextarea
          name="body"
          rows={4}
          required
          maxLength={10000}
          placeholder="Share your thoughts on this article…"
          enableSpoilers
        />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      {pendingMessage && <p className="notice" role="status">{pendingMessage}</p>}
      <div>
        <button className="btn btn-primary" type="submit" disabled={busy || !!pendingMessage}>
          {busy ? 'Posting…' : pendingMessage ? 'Awaiting review' : 'Post comment'}
        </button>
      </div>
    </form>
  );
}
