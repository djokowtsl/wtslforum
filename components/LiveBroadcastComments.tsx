'use client';

import { useEffect, useState, type FormEvent } from 'react';
import RichText from './RichText';
import styles from './LiveBroadcastComments.module.css';

type ChatMessage = {
  id: string;
  body: string;
  authorName: string;
  authorAvatar: string | null;
  createdAt: string;
};

type Props = { broadcastId: string };

export default function LiveBroadcastChat({ broadcastId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    let running = false;
    const refresh = async () => {
      if (!active || running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const response = await fetch(`/api/live-dmo/${encodeURIComponent(broadcastId)}/comments`, { cache: 'no-store' });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Live chat could not be loaded.');
        if (!active) return;
        setMessages(Array.isArray(body?.messages) ? body.messages : []);
        setError('');
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Live chat could not be loaded.');
      } finally {
        if (active) setLoading(false);
        running = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
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
        throw new Error(typeof body?.error === 'string' ? body.error : 'Your message could not be sent.');
      }
      setDraft('');
      if (response.status === 202) {
        setNotice('Your message is waiting for moderator review.');
      } else if (body?.message) {
        setMessages((current) => [...current.filter((message) => message.id !== body.message.id), body.message]);
        setNotice('Message sent.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your message could not be sent.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className={styles.comments} aria-label="Live chat">
      <h3>Live chat</h3>
      <form className={styles.form} onSubmit={submit}>
        <label htmlFor={`live-comment-${broadcastId}`}>Send a message</label>
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
            {submitting ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status" aria-live="polite">{notice}</p>}
      <div className={styles.list} aria-live="polite">
        {messages.map((message) => (
          <article className={styles.comment} key={message.id}>
            <div className={styles.identity}>
              <span className={styles.avatar} aria-hidden="true">
                <span>{message.authorName.trim().charAt(0).toUpperCase() || '?'}</span>
                {message.authorAvatar && (
                  <img
                    src={message.authorAvatar}
                    alt=""
                    loading="lazy"
                    onError={(event) => { event.currentTarget.style.display = 'none'; }}
                  />
                )}
              </span>
              <div className={styles.meta}>
                <strong>{message.authorName}</strong>
                <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString()}</time>
              </div>
            </div>
            <div className={styles.body}><RichText text={message.body} /></div>
          </article>
        ))}
        {!loading && !error && !messages.length && <p className={styles.empty}>No messages yet.</p>}
        {loading && <p className={styles.empty}>Loading live chat…</p>}
      </div>
    </section>
  );
}
