'use client';

import { useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { TOURS } from '@/lib/wtsl';

export default function MediaSubmitForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [tour, setTour] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  async function submit() {
    if (!title.trim() || (!url.trim() && !file)) {
      setErr('Add a title and either a link or a file.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      let finalUrl = url.trim();
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        const up = await fetch('/api/media/upload', { method: 'POST', body: fd });
        const upData = await up.json();
        if (!up.ok) throw new Error(upData.error || 'Upload failed');
        finalUrl = upData.url;
      }
      const res = await fetch('/api/media', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, description, url: finalUrl, tour: tour || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submission failed');
      setTitle(''); setDescription(''); setUrl(''); setFile(null); setTour(''); setOk(true);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Submission failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-card">
      <h3>Submit a clip</h3>
      <p className="notice" style={{ marginBottom: 14 }}>Paste a YouTube/Discord/Streamable/Twitch link (preferred for full matches), or upload a short clip directly (20MB max).</p>
      {err && <div className="notice" style={{ borderColor: '#ffb3bb', marginBottom: 14 }}>{err}</div>}
      {ok && <div className="notice" style={{ marginBottom: 14 }}>Clip submitted ✓</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
        <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
        <select value={tour} onChange={(e) => setTour(e.target.value)} style={inputStyle}>
          <option value="">No specific tour</option>
          {TOURS.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </select>
        <input placeholder="https://youtube.com/..." value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle} disabled={!!file} />
        <input type="file" accept="video/*,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={!!url.trim()} />
        <button className="btn btn-sm" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit clip'}</button>
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = { padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text)' };
