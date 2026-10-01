'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Admin-only lock/pin/delete controls shown at the top of a thread — the only way to lock a
 * discussion to new replies, pin it, or permanently remove it from the site itself, instead of
 * needing direct DB access. */
export default function AdminTopicControls({ topicId, locked, pinned }: { topicId: number; locked: boolean; pinned: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'lock' | 'pin' | 'delete' | null>(null);

  async function toggle(field: 'locked' | 'pinned', value: boolean) {
    setBusy(field === 'locked' ? 'lock' : 'pin');
    try {
      await fetch(`/api/topics/${topicId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm('Delete this thread and all its replies? This cannot be undone.')) return;
    setBusy('delete');
    try {
      await fetch(`/api/topics/${topicId}`, { method: 'DELETE' });
      router.push('/discussions');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-topic-controls">
      <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => toggle('locked', !locked)}>
        {busy === 'lock' ? 'Working…' : locked ? '🔓 Unlock thread' : '🔒 Lock thread'}
      </button>
      <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => toggle('pinned', !pinned)}>
        {busy === 'pin' ? 'Working…' : pinned ? '📌 Unpin' : '📌 Pin thread'}
      </button>
      <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={remove}>
        {busy === 'delete' ? 'Deleting…' : '🗑️ Delete thread'}
      </button>
    </div>
  );
}
