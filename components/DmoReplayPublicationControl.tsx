'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import styles from './DmoReplayPublicationControl.module.css';

export default function DmoReplayPublicationControl({
  id,
  hasDmoFile,
  publicShareConsent,
  overrideActive,
}: {
  id: string;
  hasDmoFile: boolean;
  publicShareConsent: boolean;
  overrideActive: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const endpoint = `/api/admin/dmo-submissions/${encodeURIComponent(id)}/publication`;

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'The replay could not be published.');
      setReason('');
      setEditing(false);
      setNotice('Published on the public Match Replays page.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The replay could not be published.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'The admin publication could not be removed.');
      setConfirmingRevoke(false);
      setNotice(publicShareConsent
        ? 'Admin publication removed. Submitter consent still keeps this replay public.'
        : 'Removed from the public Match Replays page. The stored file was kept.');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The admin publication could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.control}>
      {overrideActive ? (
        <>
          <p className={styles.status}>
            Admin publication is active
            {publicShareConsent ? ' · submitter consent is also active' : ''}
          </p>
          {confirmingRevoke ? (
            <div className={styles.confirm}>
              <p>
                {publicShareConsent
                  ? 'This removes the admin override, but the replay remains public through submitter consent.'
                  : 'This removes the replay from the public page but keeps its uploaded file and signed-in member access.'}
              </p>
              <div className={styles.actions}>
                <button
                  className="btn btn-sm btn-ghost"
                  type="button"
                  onClick={() => setConfirmingRevoke(false)}
                  disabled={busy}
                >
                  Keep publication
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  onClick={() => void revoke()}
                  disabled={busy}
                >
                  {busy ? 'Removing…' : 'Revoke admin publication'}
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => {
                setError('');
                setConfirmingRevoke(true);
              }}
              disabled={busy}
            >
              Revoke admin publication
            </button>
          )}
        </>
      ) : publicShareConsent ? (
        <p className={styles.status}>Public through submitter consent</p>
      ) : !hasDmoFile ? (
        <p className={styles.note}>A stored .dmo file is required for public playback.</p>
      ) : editing ? (
        <form className={styles.form} onSubmit={publish}>
          <p className={styles.warning}>
            This makes the uploaded replay available to public visitors. Your admin identity and reason will be recorded.
          </p>
          <label htmlFor={`publication-reason-${id}`}>Reason for publishing</label>
          <textarea
            id={`publication-reason-${id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={5}
            maxLength={500}
            required
            rows={2}
            placeholder="For example, permission confirmed with both players"
          />
          <div className={styles.actions}>
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() => {
                setEditing(false);
                setReason('');
                setError('');
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button className="btn btn-sm" type="submit" disabled={busy || reason.trim().length < 5}>
              {busy ? 'Publishing…' : 'Publish publicly'}
            </button>
          </div>
        </form>
      ) : (
        <button
          className="btn btn-sm"
          type="button"
          onClick={() => {
            setError('');
            setEditing(true);
          }}
          disabled={busy}
        >
          Publish to public Match Replays
        </button>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </div>
  );
}
