'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function DmoSubmissionVisibilityControl({
  id,
  hidden,
  hiddenBy,
}: {
  id: string;
  hidden: boolean;
  hiddenBy: string;
}) {
  const router = useRouter();
  const [confirmingHide, setConfirmingHide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function updateVisibility(nextHidden: boolean) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(
        `/api/admin/dmo-submissions/${encodeURIComponent(id)}/visibility`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hidden: nextHidden }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Replay visibility could not be changed.');
      setConfirmingHide(false);
      setNotice(nextHidden
        ? 'Hidden from Forum Match Replays. The private file and separate TE4 Coach sharing are unchanged.'
        : 'Restored to Forum Match Replays, subject to its existing consent or publication.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Replay visibility could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ flexBasis: '100%', display: 'grid', justifyItems: 'start', gap: 8 }}>
      {hidden ? (
        <>
          <p className="notice" style={{ margin: 0 }}>
            Hidden from Forum Match Replays{hiddenBy ? ` by Discord ${hiddenBy}` : ''}. The file remains stored.
          </p>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => void updateVisibility(false)}
            disabled={busy}
          >
            {busy ? 'Restoring…' : 'Restore replay listing'}
          </button>
        </>
      ) : confirmingHide ? (
        <div
          style={{
            display: 'grid',
            gap: 8,
            maxWidth: 620,
            padding: 12,
            border: '1px solid var(--line-2)',
            borderRadius: 8,
          }}
        >
          <p className="notice" style={{ margin: 0 }}>
            This hides the replay from public and signed-in Forum Match Replays pages without deleting
            its private file. Separate TE4 Coach sharing is unchanged.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => setConfirmingHide(false)}
              disabled={busy}
            >
              Keep visible
            </button>
            <button
              className="btn btn-sm"
              type="button"
              onClick={() => void updateVisibility(true)}
              disabled={busy}
            >
              {busy ? 'Hiding…' : 'Hide replay'}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="btn btn-sm btn-ghost"
          type="button"
          onClick={() => {
            setError('');
            setConfirmingHide(true);
          }}
          disabled={busy}
        >
          Hide from Match Replays
        </button>
      )}
      {error && <p className="notice" role="alert" style={{ margin: 0 }}>{error}</p>}
      {notice && <p className="notice" role="status" style={{ margin: 0 }}>{notice}</p>}
    </div>
  );
}
