'use client';

import { useId, useState } from 'react';
import MentionTextarea from '@/components/MentionTextarea';

type Props =
  | { target: 'discussion'; topicId: number; parentId: number }
  | { target: 'article'; articleId: number; parentId: number };

export default function ReplyToComment(props: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingMessage, setPendingMessage] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const body = new FormData(form).get('body');
    setBusy(true);
    setError('');
    try {
      const discussion = props.target === 'discussion';
      const response = await fetch(
        discussion ? '/api/replies' : `/api/articles/${props.articleId}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(discussion
            ? { topicId: props.topicId, parentReplyId: props.parentId, body }
            : { parentCommentId: props.parentId, body }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (response.status === 202 && result.pending) {
        setPendingMessage(result.message || 'Your reply is waiting for moderator review.');
        form.reset();
      } else if (response.ok) {
        window.location.reload();
      } else {
        setError(result.error || 'Unable to post your reply.');
      }
    } catch {
      setError('Network problem — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="comment-reply-area">
      <button
        className="btn btn-sm btn-ghost comment-reply-toggle"
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setOpen((value) => !value);
          setError('');
        }}
      >
        {open ? 'Cancel reply' : 'Reply'}
      </button>
      {open && (
        <form id={id} className="comment-reply-form" onSubmit={submit}>
          {pendingMessage ? (
            <p className="notice" role="status">{pendingMessage}</p>
          ) : (
            <>
              <label>
                Your reply
                <MentionTextarea
                  name="body"
                  rows={3}
                  required
                  maxLength={10000}
                  placeholder="Write a reply to this comment…"
                  enableSpoilers
                />
              </label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="comment-reply-actions">
                <button className="btn btn-sm btn-primary" type="submit" disabled={busy}>
                  {busy ? 'Posting…' : 'Post reply'}
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => { setOpen(false); setError(''); }}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
