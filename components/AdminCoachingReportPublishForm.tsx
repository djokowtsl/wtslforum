'use client';

import { uploadPresigned } from '@vercel/blob/client';
import { useState, type FormEvent } from 'react';
import type { Te4ViewerData } from '@/lib/te4DmoTypes';
import styles from './AdminCoachingReportPublishForm.module.css';

type Props = {
  viewer: Te4ViewerData;
};

type ConsentState = {
  submitter: boolean;
  player1: boolean;
  player2: boolean;
  review: boolean;
};

type ConsentReferences = {
  submitter: string;
  player1: string;
  player2: string;
};

const STAGING_PREFIX = 'dmo-coaching-report-staging/';
const MAX_REPLAY_BYTES = 64 * 1024 * 1024;

export default function AdminCoachingReportPublishForm({ viewer }: Props) {
  const [tournament, setTournament] = useState(viewer.tournament ?? '');
  const [roundName, setRoundName] = useState('');
  const [consentReferences, setConsentReferences] = useState<ConsentReferences>({
    submitter: '',
    player1: '',
    player2: '',
  });
  const [consent, setConsent] = useState<ConsentState>({
    submitter: false,
    player1: false,
    player2: false,
    review: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [publishedId, setPublishedId] = useState('');
  const allChecked = Object.values(consent).every(Boolean);

  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !allChecked) return;
    setBusy(true);
    setError('');
    try {
      const replayJson = JSON.stringify(viewer);
      const replayFile = new File([replayJson], 'coaching-replay.json', {
        type: 'application/json',
      });
      if (replayFile.size > MAX_REPLAY_BYTES) {
        throw new Error('This replay is larger than the 64 MiB publication limit.');
      }

      const stagingPath = `${STAGING_PREFIX}${crypto.randomUUID()}.json`;
      await uploadPresigned(stagingPath, replayFile, {
        access: 'private',
        handleUploadUrl: '/api/admin/coaching-reports/upload',
        contentType: 'application/json',
        multipart: true,
      });

      const response = await fetch('/api/admin/coaching-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stagingPath,
          tournament,
          roundName,
          consent,
          consentReferences,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.id !== 'string') {
        throw new Error(
          typeof payload?.error === 'string'
            ? payload.error
            : `The report could not be published (${response.status}).`,
        );
      }
      setPublishedId(payload.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The report could not be published. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const updateConsent = (key: keyof ConsentState, checked: boolean) => {
    setConsent((current) => ({ ...current, [key]: checked }));
  };

  const updateConsentReference = (key: keyof ConsentReferences, value: string) => {
    setConsentReferences((current) => ({ ...current, [key]: value }));
  };

  if (publishedId) {
    return (
      <section className={styles.published} aria-live="polite">
        <div>
          <span className={styles.eyebrow}>PUBLIC REPORT</span>
          <h2>Report published</h2>
          <p>The replay is now visible on the public Coaching Hub. The source DMO remains private.</p>
        </div>
        <a className="btn btn-primary" href={`/coaching-hub/${publishedId}`}>View public report</a>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-labelledby="publish-report-title">
      <div className={styles.heading}>
        <span className={styles.eyebrow}>REVIEWED PUBLICATION</span>
        <h2 id="publish-report-title">Publish this coaching report</h2>
        <p>
          Publishing makes the reconstructed replay and match details public. The original DMO
          file and staff analysis workspace remain private.
        </p>
      </div>

      <form className={styles.form} onSubmit={publish}>
        <div className={styles.metadata}>
          <label>
            <span>Tournament or event</span>
            <input
              value={tournament}
              maxLength={160}
              required
              onChange={(event) => setTournament(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>Round or match label</span>
            <input
              value={roundName}
              maxLength={80}
              required
              placeholder="e.g. Semi-final"
              onChange={(event) => setRoundName(event.currentTarget.value)}
            />
          </label>
        </div>

        <fieldset className={styles.checks}>
          <legend>Confirm before publishing</legend>
          <label>
            <input
              type="checkbox"
              checked={consent.submitter}
              onChange={(event) => updateConsent('submitter', event.currentTarget.checked)}
            />
            <span>The submitter confirmed this is an official match and agreed to public sharing.</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={consent.player1}
              onChange={(event) => updateConsent('player1', event.currentTarget.checked)}
            />
            <span>{viewer.names[0]} explicitly agreed to public sharing.</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={consent.player2}
              onChange={(event) => updateConsent('player2', event.currentTarget.checked)}
            />
            <span>{viewer.names[1]} explicitly agreed to public sharing.</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={consent.review}
              onChange={(event) => updateConsent('review', event.currentTarget.checked)}
            />
            <span>I reviewed the score, names, and replay, and approve this report.</span>
          </label>
        </fieldset>

        <div className={styles.evidenceGrid}>
          {([
            ['submitter', 'Submitter'],
            ['player1', viewer.names[0]],
            ['player2', viewer.names[1]],
          ] as const).map(([key, label]) => (
            <label className={styles.evidence} key={key}>
              <span>{label} consent record</span>
              <textarea
                value={consentReferences[key]}
                onChange={(event) => updateConsentReference(key, event.currentTarget.value)}
                maxLength={300}
                minLength={10}
                required
                rows={2}
                placeholder="Record how consent was verified. Do not paste private messages."
              />
            </label>
          ))}
          <small className={styles.evidenceNote}>
            These notes are admin-only. Record the source or method and approximate date; do not
            paste private messages or sensitive details.
          </small>
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !allChecked}>
          {busy ? 'Saving private replay…' : 'Approve and publish'}
        </button>
      </form>
    </section>
  );
}
