'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Admin-only lock/pin toggle shown at the top of a thread — the only way to close a discussion
 * to new replies (or pin it) from the site itself, instead of needing direct DB access. */
export default function AdminTopicControls({ topicId, locked, pinned }: { topicId: number; locked: boolean; pinned: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'lock' | 'pin' | null>(null);

  async function toggle(field: 'locked' | 'pinned', value: boolean) {
    setBusy(field === 'locked' ? 'lock' : 'pin');
    try {
      await fetch(`/api/topics/${topicId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }) });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-topic-controls">
      <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => toggle('locked', !locked)}>
        {busy === 'lock' ? 'Working…' : locked ? '🔓 Unlock thread' : '🔒 Close thread'}
      </button>
      <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => toggle('pinned', !pinned)}>
        {busy === 'pin' ? 'Working…' : pinned ? '📌 Unpin' : '📌 Pin thread'}
      </button>
    </div>
  );
}
