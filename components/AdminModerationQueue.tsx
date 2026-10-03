'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import RichText from './RichText';

export type ModerationQueueItem = {
  id: number;
  kind: 'topic' | 'reply' | 'media' | 'note';
  title: string;
  body: string;
  author: string | null;
  createdAt: string;
  reason: string | null;
  externalUrl?: string | null;
  privateFile?: boolean;
  privateContentType?: string | null;
};

export default function AdminModerationQueue({ items }: { items: ModerationQueueItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function review(item: ModerationQueueItem, action: 'approve' | 'remove') {
    const key = `${item.kind}:${item.id}`;
    setBusy(key);
    setError('');
    try {
      const response = await fetch('/api/admin/moderation/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: item.kind, id: item.id, action }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.error || 'Unable to save the review decision.'); return; }
      router.refresh();
    } catch {
      setError('Network problem — please try again.');
    } finally {
      setBusy(null);
    }
  }

  if (!items.length) return <div className="notice">Nothing is waiting for moderator review.</div>;
  return (
    <div className="moderation-queue">
      {items.map((item) => {
        const key = `${item.kind}:${item.id}`;
        const type = item.privateContentType || '';
        const previewUrl = `/api/admin/moderation/media/${item.id}`;
        return (
          <article className="moderation-item" key={key}>
            <div className="moderation-item-meta">
              <span className="pill">{item.kind}</span>
              <span>{item.author || 'Member'} · {new Date(item.createdAt).toLocaleString()}</span>
            </div>
            <h2>{item.title}</h2>
            {item.reason && <p className="moderation-reason">Screening/review note: {item.reason}</p>}
            {item.kind === 'media' && item.privateFile && type.startsWith('image/') && (
              <img className="moderation-preview" src={previewUrl} alt={`Private review preview for ${item.title}`} />
            )}
            {item.kind === 'media' && item.privateFile && type.startsWith('video/') && (
              <video className="moderation-preview" src={previewUrl} controls preload="metadata" />
            )}
            {item.kind === 'media' && !item.privateFile && item.externalUrl && (
              <p><a href={item.externalUrl} target="_blank" rel="noreferrer noopener">Open submitted media in a new tab ↗</a></p>
            )}
            {item.body && <div className="moderation-item-body"><RichText text={item.body} /></div>}
            <div className="moderation-item-actions">
              <button className="btn btn-sm btn-primary" type="button" disabled={busy === key} onClick={() => review(item, 'approve')}>{busy === key ? 'Saving…' : 'Approve'}</button>
              <button className="btn btn-sm btn-ghost" type="button" disabled={busy === key} onClick={() => review(item, 'remove')}>Remove</button>
            </div>
          </article>
        );
      })}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}