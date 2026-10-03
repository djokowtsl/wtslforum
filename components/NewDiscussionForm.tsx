'use client';
import { useState } from 'react';
import MentionTextarea from './MentionTextarea';

type Props = {
  categories: any[];
  initialTitle?: string;
  initialBody?: string;
  matchKey?: string;
  tour?: string;
  initialCategoryId?: string | number;
};

export default function NewDiscussionForm({ categories, initialTitle, initialBody, matchKey, tour, initialCategoryId }: Props) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingMessage, setPendingMessage] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setPendingMessage('');
    const f = new FormData(e.currentTarget);
    const body = String(f.get('body') || '').trim();
    // A match thread is only ever actually created once someone writes a real first post — an
    // auto-filled starter post left untouched (or cleared out) must not spawn a stale thread.
    if (matchKey && (!body || body === (initialBody || '').trim())) {
      setError('Add your own thoughts to the post before publishing this match thread.');
      setBusy(false);
      return;
    }
    try {
      const r = await fetch('/api/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: f.get('title'), categoryId: f.get('categoryId'), body: f.get('body'), matchKey, tour }) });
      const x = await r.json().catch(() => ({}));
      if (r.ok && x.pending) setPendingMessage(x.message || 'Your discussion is waiting for moderator review.');
      else if (r.ok) location.href = '/discussions/' + x.id;
      else setError(x.error || 'Unable to publish your discussion.');
    } catch {
      setError('Network problem — please try again.');
    }
    setBusy(false);
  }

  return (
    <form className="form-card" onSubmit={submit}>
      {matchKey && <p className="notice">This will create the Match Talk thread for this match — write something below to publish it.</p>}
      <label>Title<input name="title" required maxLength={140} placeholder="e.g. US Open final — that second set" defaultValue={initialTitle || ''} readOnly={!!matchKey} /></label>
      {matchKey && initialCategoryId !== undefined ? (
        <input type="hidden" name="categoryId" value={String(initialCategoryId)} />
      ) : (
        <label>
          Category
          <select name="categoryId" required defaultValue={initialCategoryId !== undefined ? String(initialCategoryId) : undefined}>
            {categories.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      <label>Post<MentionTextarea name="body" required rows={11} maxLength={20000} placeholder="Write your post…" defaultValue={initialBody || ''} enableSpoilers /></label>
      {error && <p className="form-error">{error}</p>}
      {pendingMessage && <p className="notice" role="status">{pendingMessage}</p>}
      <div><button className="btn btn-primary" type="submit" disabled={busy || !!pendingMessage}>{busy ? 'Publishing…' : pendingMessage ? 'Awaiting review' : 'Publish discussion'}</button></div>
    </form>
  );
}
