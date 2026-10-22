'use client';

import { useEffect, useState, type FormEvent } from 'react';
import RichText from './RichText';
import styles from './LiveBroadcastComments.module.css';

type BroadcastComment = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
};

type Props = { broadcastId: string };

export default function LiveBroadcastComments({ broadcastId }: Props) {
  const [comments, setComments] = useState<BroadcastComment[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    let running = false;
    const refresh = async () => {
      if (!active || running) return;
      running = true;
      try {
        const response = await fetch(`/api/live-dmo/${encodeURIComponent(broadcastId)}/comments`, { cache: 'no-store' });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Comments could not be loaded.');
        if (!active) return;
        setComments(Array.isArray(body?.comments) ? body.comments : []);
        setError('');
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Comments could not be loaded.');
      } finally {
        if (active) setLoading(false);
        running = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 8_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [broadcastId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/live-dmo/${encodeURIComponent(broadcastId)}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok && response.status !== 202) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Your comment could not be posted.');
      }
      setDraft('');
      if (response.status === 202) {
        setNotice('Your comment is waiting for moderator review.');
      } else if (body?.comment) {
        setComments((current) => [...current.filter((comment) => comment.id !== body.comment.id), body.comment]);
        setNotice('Comment posted.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your comment could not be posted.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={styles.comments} aria-label="Live stream comments">
      <h3>Comments</h3>
      <form className={styles.form} onSubmit={submit}>
        <label htmlFor={`live-comment-${broadcastId}`}>Add a comment</label>
        <textarea
          id={`live-comment-${broadcastId}`}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          maxLength={500}
          rows={2}
          placeholder="Join the conversation…"
          disabled={submitting}
        />
        <div className={styles.formFooter}>
          <span>{draft.length}/500</span>
          <button type="submit" className="btn btn-sm btn-primary" disabled={submitting || !draft.trim()}>
            {submitting ? 'Posting…' : 'Post comment'}
          </button>
        </div>
      </form>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status" aria-live="polite">{notice}</p>}
      <div className={styles.list} aria-live="polite">
        {comments.map((comment) => (
          <article className={styles.comment} key={comment.id}>
            <div className={styles.meta}>
              <strong>{comment.authorName}</strong>
              <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleTimeString()}</time>
            </div>
            <div className={styles.body}><RichText text={comment.body} /></div>
          </article>
        ))}
        {!loading && !error && !comments.length && <p className={styles.empty}>No comments yet.</p>}
        {loading && <p className={styles.empty}>Loading comments…</p>}
      </div>
    </section>
  );
}
