'use client';
import { useState } from 'react';

export default function NewDiscussionForm({ categories }: { categories: any[] }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch('/api/topics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: f.get('title'), categoryId: f.get('categoryId'), body: f.get('body') }) });
      const x = await r.json().catch(() => ({}));
      if (r.ok) location.href = '/discussions/' + x.id;
      else setError(x.error || 'Unable to publish your discussion.');
    } catch {
      setError('Network problem — please try again.');
    }
    setBusy(false);
  }

  return (
    <form className="form-card" onSubmit={submit}>
      <label>Title<input name="title" required maxLength={140} placeholder="e.g. US Open final — that second set" /></label>
      <label>
        Category
        <select name="categoryId" required>
          {categories.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label>Post<textarea name="body" required rows={11} maxLength={20000} placeholder="Write your post…" /></label>
      {error && <p className="form-error">{error}</p>}
      <div><button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Publishing…' : 'Publish discussion'}</button></div>
    </form>
  );
}
