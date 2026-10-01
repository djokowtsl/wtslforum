'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { tourLabel } from '@/lib/wtsl';

type Clip = { id: number; title: string; description: string; url: string; tour: string | null; author: string | null; avatar: string | null; created_at: string; youtube_id: string | null };

export default function MediaGrid({ clips, canManage, currentUserId }: { clips: Clip[]; canManage: boolean; currentUserId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);

  async function remove(id: number) {
    setBusy(id);
    try {
      await fetch(`/api/media/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!clips.length) return <div className="notice">No clips submitted yet — be the first to share a highlight.</div>;

  return (
    <div className="award-grid">
      {clips.map((c) => (
        <div className="award-card" key={c.id}>
          {c.youtube_id ? (
            <div style={{ position: 'relative', paddingTop: '56.25%', marginBottom: 14, borderRadius: 10, overflow: 'hidden' }}>
              <iframe
                src={`https://www.youtube.com/embed/${c.youtube_id}`}
                title={c.title}
                allowFullScreen
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
              />
            </div>
          ) : (
            <a href={c.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost" style={{ marginBottom: 14, display: 'inline-block' }}>Watch clip ↗</a>
          )}
          <h3 style={{ fontSize: 22 }}>{c.title}</h3>
          {c.description && <p>{c.description}</p>}
          <div className="award-winner">
            <b>{c.author ?? 'Member'}</b>
            <span>{c.tour ? tourLabel(c.tour) : 'General'}</span>
          </div>
          {(canManage || String(currentUserId) === String((c as any).submitted_by)) && (
            <button className="btn btn-sm btn-ghost" disabled={busy === c.id} onClick={() => remove(c.id)} style={{ marginTop: 10 }}>Remove</button>
          )}
        </div>
      ))}
    </div>
  );
}
