'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AdminCoachingReport } from '@/lib/coachingReports';
import styles from './AdminCoachingReportsManager.module.css';

type SerializedReport = Omit<
  AdminCoachingReport,
  'published_at' | 'consent_recorded_at' | 'reviewed_at' | 'unpublished_at'
> & {
  published_at: string;
  consent_recorded_at: string;
  reviewed_at: string;
  unpublished_at: string | null;
};

function displayDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
}

export default function AdminCoachingReportsManager({
  initialReports,
}: {
  initialReports: SerializedReport[];
}) {
  const [reports, setReports] = useState(initialReports);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [cleanupWarning, setCleanupWarning] = useState('');
  const [cleanupStatus, setCleanupStatus] = useState<Record<string, string>>({});

  const unpublish = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    setError('');
    setCleanupWarning('');
    try {
      const response = await fetch(`/api/admin/coaching-reports/${id}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) {
        throw new Error(
          typeof payload?.error === 'string' ? payload.error : 'The report could not be removed.',
        );
      }
      setReports((current) => current.map((report) => (
        report.id === id
          ? report.unpublished_at
            ? report
            : { ...report, unpublished_at: new Date().toISOString(), unpublished_by_discord_id: 'admin' }
          : report
      )));
      setConfirmingId(null);
      if (payload.storageCleanupPending) {
        setCleanupWarning('The report is hidden from the public site, but private replay cleanup is still pending.');
        setCleanupStatus((current) => ({ ...current, [id]: 'Replay cleanup is still pending. Retry when storage is available.' }));
      } else {
        setCleanupStatus((current) => ({ ...current, [id]: 'Private replay copy is deleted or already absent.' }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The report could not be removed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.list}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {cleanupWarning && <p className={styles.warning} role="status">{cleanupWarning}</p>}
      {reports.length === 0 ? (
        <div className="notice">No coaching reports have been published.</div>
      ) : reports.map((report) => {
        const isPublic = !report.unpublished_at;
        return (
          <article className="admin-card" key={report.id}>
            <div className={styles.top}>
              <div>
                <span className={`${styles.state} ${isPublic ? styles.public : styles.removed}`}>
                  {isPublic ? 'Public' : 'Removed from public view'}
                </span>
                <h2>{report.tournament} — {report.round_name}</h2>
                <p><strong>{report.player1}</strong> vs <strong>{report.player2}</strong> · {report.score}</p>
              </div>
              {isPublic && <Link className="btn btn-sm btn-ghost" href={`/coaching-hub/${report.id}`}>View public page</Link>}
            </div>

            <div className={styles.audit}>
              <span>Submitter consent: {report.submitter_consent ? 'confirmed' : 'missing'}</span>
              <span>{report.player1}: {report.player1_consent ? 'confirmed' : 'missing'}</span>
              <span>{report.player2}: {report.player2_consent ? 'confirmed' : 'missing'}</span>
              <span>Staff review: {report.review_confirmed ? 'confirmed' : 'missing'}</span>
            </div>
            <p className={styles.privateNote}>
              <strong>Submitter consent:</strong> {report.submitter_consent_reference}
            </p>
            <p className={styles.privateNote}>
              <strong>{report.player1} consent:</strong> {report.player1_consent_reference}
            </p>
            <p className={styles.privateNote}>
              <strong>{report.player2} consent:</strong> {report.player2_consent_reference}
            </p>
            <p className={styles.timestamps}>
              Published {displayDate(report.published_at)} · Consent recorded {displayDate(report.consent_recorded_at)}
              {report.unpublished_at && ` · Removed ${displayDate(report.unpublished_at)}`}
            </p>
            <p className={styles.timestamps}>
              Consent recorded by Discord ID {report.consent_recorded_by_discord_id} · Reviewed by Discord ID {report.reviewed_by_discord_id}
            </p>

            {isPublic && (
              confirmingId === report.id ? (
                <div className={styles.confirm}>
                  <p>This hides the public report and deletes its private replay copy. The admin consent record remains.</p>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={busyId === report.id}
                    onClick={() => void unpublish(report.id)}
                  >
                    {busyId === report.id ? 'Removing…' : 'Remove report'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={busyId === report.id}
                    onClick={() => setConfirmingId(null)}
                  >
                    Keep public
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={busyId !== null}
                  onClick={() => setConfirmingId(report.id)}
                >
                  Remove from public view
                </button>
              )
            )}
            {!isPublic && (
              <div className={styles.confirm}>
                <p>This report is already hidden. You can safely retry deleting its private replay copy.</p>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={busyId !== null}
                  onClick={() => void unpublish(report.id)}
                >
                  {busyId === report.id ? 'Checking storage…' : 'Retry private replay cleanup'}
                </button>
                {cleanupStatus[report.id] && <p role="status">{cleanupStatus[report.id]}</p>}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
