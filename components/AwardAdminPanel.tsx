'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Nominee = { id: number; name: string; note: string };
type Category = {
  id: number;
  name: string;
  slug: string;
  allow_write_in: boolean;
  shuffle_options: boolean;
  shuffle_options_override: boolean | null;
  is_required: boolean;
  nominees: Nominee[];
};
type FormPreview = {
  sourceUrl: string;
  questionCount: number;
  optionCount: number;
  questions: { title: string; slug: string; optionCount: number; allowWriteIn: boolean; shuffleOptions: boolean; isRequired: boolean; examples: string[] }[];
};
type SyncSummary = {
  counts: {
    queued: number;
    processing: number;
    waiting_required: number;
    synced: number;
    retryable: number;
    needs_review: number;
  };
  recentIssues: Array<{
    reference: string;
    status: 'retryable' | 'needs_review';
    attempts: number;
    lastAttemptAt: string | null;
    errorCode: string | null;
  }>;
};

export default function AwardAdminPanel({ cycleId, votingOpen, categories, formSyncConfigured = false, initialSyncSummary }: {
  cycleId: number;
  votingOpen: boolean;
  categories: Category[];
  formSyncConfigured?: boolean;
  initialSyncSummary?: SyncSummary;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [newNominee, setNewNominee] = useState<Record<number, string>>({});
  const [csv, setCsv] = useState<Record<number, string>>({});
  const [err, setErr] = useState('');
  const [formSyncMessage, setFormSyncMessage] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formPreview, setFormPreview] = useState<FormPreview | null>(null);
  const [formMessage, setFormMessage] = useState('');
  const [syncSummary, setSyncSummary] = useState<SyncSummary | undefined>(initialSyncSummary);
  const [checkingIssue, setCheckingIssue] = useState<string | null>(null);
  const [issueCheckMessages, setIssueCheckMessages] = useState<Record<string, string>>({});

  async function refreshSyncSummary() {
    try {
      const res = await fetch(`/api/admin/awards?cycleId=${cycleId}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.syncSummary) setSyncSummary(data.syncSummary as SyncSummary);
    } catch {
      // Keep the last known admin status visible if a refresh is temporarily unavailable.
    }
  }

  const hasActiveSyncJobs = Boolean(syncSummary?.counts.queued || syncSummary?.counts.processing);
  useEffect(() => {
    if (!hasActiveSyncJobs) return;
    const timer = window.setInterval(() => { void refreshSyncSummary(); }, 3000);
    return () => window.clearInterval(timer);
  }, [cycleId, hasActiveSyncJobs]);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/admin/awards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleFormOptions(action: 'preview-form-options' | 'import-form-options') {
    setBusy(true);
    setErr('');
    setFormMessage('');
    try {
      const res = await fetch('/api/admin/awards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, cycleId, formUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load Google Form choices.');

      if (action === 'preview-form-options') {
        setFormPreview(data as FormPreview);
      } else {
        setFormPreview(null);
        const renamedOptions = Array.isArray(data.renamedOptions) ? data.renamedOptions : [];
        const renameSummary = renamedOptions.length
          ? ` Updated ${renamedOptions.length} existing choice label${renamedOptions.length === 1 ? '' : 's'}: ${renamedOptions.map((option: { from: string; to: string }) => `“${option.from}” → “${option.to}”`).join('; ')}.`
          : '';
        setFormMessage(`Imported ${data.optionsAdded} new choices across ${data.categoriesImported} award categories (${data.requiredQuestionsImported} required, ${data.optionalQuestionsImported} optional).${renameSummary} ${data.shuffleCategoriesImported} categories have Google Form option shuffling enabled. ${data.optionsAlreadyPresent} choices were already present. Existing votes were kept.`);
        router.refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load Google Form choices.');
    } finally {
      setBusy(false);
    }
  }

  async function syncForumBallotsToForm() {
    setBusy(true);
    setErr('');
    setFormSyncMessage('');
    let afterBallotCursor = '0';
    let skippedIncomplete = false;
    let skippedNeedsReview = 0;
    try {
      while (true) {
        const res = await fetch('/api/admin/awards', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'sync-form-batch', cycleId, afterBallotCursor }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not submit Forum ballots to Google Forms.');
        afterBallotCursor = String(data.nextAfterBallotCursor ?? afterBallotCursor);
        skippedIncomplete ||= data.skippedIncomplete === true;
      skippedNeedsReview += Number(data.skippedNeedsReview ?? 0);
        setFormSyncMessage('Syncing complete Forum ballots to the linked Google Form…');
        if (data.done) break;
      }
      setFormSyncMessage([
        skippedIncomplete
          ? 'Ballots missing required answers remain saved in the Forum and were not submitted.'
          : 'Forum ballot backfill completed. The previous “Forum Votes” tab was left untouched.',
        skippedNeedsReview
          ? `${skippedNeedsReview} ballot${skippedNeedsReview === 1 ? '' : 's'} needing review were skipped to avoid duplicate submissions.`
          : '',
      ].filter(Boolean).join(' '));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not submit Forum ballots to Google Forms.');
    } finally {
      setBusy(false);
    }
  }

  async function retrySafeSyncJobs() {
    setBusy(true);
    setErr('');
    setFormSyncMessage('');
    try {
      const res = await fetch('/api/admin/awards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'retry-safe-form-sync-jobs', cycleId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not retry safe sync jobs.');
      setFormSyncMessage(`Queued ${Number(data.queued ?? 0)} safe sync retr${Number(data.queued ?? 0) === 1 ? 'y' : 'ies'}. Ballots needing review are not retried automatically.`);
      await refreshSyncSummary();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not retry safe sync jobs.');
    } finally {
      setBusy(false);
    }
  }

  async function checkExistingFormResponse(jobId: string) {
    setBusy(true);
    setErr('');
    setCheckingIssue(jobId);
    setIssueCheckMessages((current) => ({ ...current, [jobId]: '' }));
    try {
      const res = await fetch('/api/admin/awards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'check-form-sync-job', cycleId, jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not check the existing Form response.');

      const messages: Record<string, string> = {
        confirmed: 'Matching Form response confirmed; this job is marked synced.',
        not_found: 'No managed receipt was found. This does not prove the Form rejected it; check the linked Form response list before any retry.',
        ambiguous: 'Multiple managed receipts were found. This job remains in review.',
        response_missing: 'A receipt row exists, but its Form response is missing. This job remains in review.',
        unverifiable: 'The response could not be verified from sync metadata. This job remains in review.',
        ballot_changed: 'The saved ballot changed since this job was created. This job remains in review.',
        response_mismatch: 'A Form response exists but does not match the current saved ballot. This job remains in review.',
        receipt_conflict: 'A newer receipt is already stored. This job remains in review.',
        unavailable: 'The Form could not be checked now. This job remains in review.',
      };
      setIssueCheckMessages((current) => ({
        ...current,
        [jobId]: messages[String(data.result)] ?? 'The response check did not finish. This job remains in review.',
      }));
      if (data.result === 'confirmed') await refreshSyncSummary();
    } catch (e) {
      setIssueCheckMessages((current) => ({
        ...current,
        [jobId]: e instanceof Error ? e.message : 'Could not check the existing Form response.',
      }));
    } finally {
      setCheckingIssue(null);
      setBusy(false);
    }
  }

  return (
    <div className="admin-card">
      <h3>Awards voting</h3>
      <p className="notice" style={{ marginBottom: 14 }}>
        Voting is currently <b>{votingOpen ? 'OPEN' : 'closed'}</b>. Import award choices from a public Google Form below or manage nominees here. Previous Google Form votes can still be imported from a simplified CSV.
      </p>
      {err && <div className="notice" style={{ borderColor: '#ffb3bb', marginBottom: 14 }}>{err}</div>}
      {formMessage && <div className="notice" role="status" style={{ marginBottom: 14 }}>{formMessage}</div>}
      <button className="btn btn-sm" disabled={busy} onClick={() => call({ action: 'toggle-voting', cycleId, open: !votingOpen })}>
        {votingOpen ? 'Close voting' : 'Open voting'}
      </button>

      <section className="forum-list" style={{ marginTop: 20, padding: 16 }} aria-labelledby="award-sheet-sync-title">
        <h4 id="award-sheet-sync-title" style={{ margin: '0 0 6px' }}>Native Google Form response sync</h4>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
          {formSyncConfigured
            ? 'Complete Forum ballots are submitted as native responses to the linked Google Form. Later edits replace the previous Forum-managed response. Existing rows in the old “Forum Votes” tab are not changed.'
            : 'The Apps Script bridge and server settings are not configured yet. Forum voting remains available; ballots will not reach Google Forms until setup is complete.'}
        </p>
        <button className="btn btn-sm" disabled={busy || !formSyncConfigured} onClick={syncForumBallotsToForm}>
          {busy ? 'Syncing…' : 'Backfill Forum ballots to Google Form'}
        </button>
        <button className="btn btn-sm" disabled={busy || !formSyncConfigured} onClick={retrySafeSyncJobs} style={{ marginLeft: 8 }}>
          Retry safe failures
        </button>
        {formSyncMessage && <p role="status" style={{ margin: '10px 0 0', fontSize: 13 }}>{formSyncMessage}</p>}
        {syncSummary && (
          <div aria-live="polite" style={{ marginTop: 14, fontSize: 13 }}>
            <strong>Sync status</strong>
            <p style={{ margin: '6px 0', color: 'var(--muted)' }}>
              Queued: {syncSummary.counts.queued} · Processing: {syncSummary.counts.processing} · Waiting for required answers: {syncSummary.counts.waiting_required} · Synced: {syncSummary.counts.synced} · Retryable: {syncSummary.counts.retryable} · Needs review: {syncSummary.counts.needs_review}
            </p>
            {syncSummary.counts.needs_review > 0 && (
              <p style={{ margin: '6px 0', color: '#ffb36b' }}>
                Jobs needing review are not retried automatically because a response may already exist. The response check is read-only; if no managed receipt is found, verify the linked Form response list before any retry.
              </p>
            )}
            {syncSummary.recentIssues.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, color: 'var(--muted)' }}>
                {syncSummary.recentIssues.map((issue) => (
                  <li key={issue.reference}>
                    Job {issue.reference}: {issue.status.replace('_', ' ')}; {issue.attempts} attempt{issue.attempts === 1 ? '' : 's'}
                    {issue.errorCode ? ` (${issue.errorCode})` : ''}
                    {issue.status === 'needs_review' && (
                      <div style={{ marginTop: 6 }}>
                        <button
                          className="btn btn-sm"
                          disabled={busy || !formSyncConfigured}
                          onClick={() => { void checkExistingFormResponse(issue.reference); }}
                        >
                          {checkingIssue === issue.reference ? 'Checking…' : 'Check existing response'}
                        </button>
                        {issueCheckMessages[issue.reference] && (
                          <p role="status" style={{ margin: '6px 0 0' }}>{issueCheckMessages[issue.reference]}</p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="forum-list" style={{ marginTop: 20, padding: 16 }} aria-labelledby="award-form-import-title">
        <h4 id="award-form-import-title" style={{ margin: '0 0 6px' }}>Import award choices from a Google Form</h4>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
          Paste a public response link to preview its award questions and choices. Import matches existing categories, adds missing choices, and syncs required/optional, write-in, and shuffle settings from the form; it keeps existing choices and votes.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input
            type="url"
            value={formUrl}
            onChange={(event) => { setFormUrl(event.target.value); setFormPreview(null); }}
            placeholder="https://forms.gle/…"
            aria-label="Public Google Form link"
            style={{ flex: '1 1 320px', minWidth: 0, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text)' }}
          />
          <button className="btn btn-sm" disabled={busy || !formUrl.trim()} onClick={() => handleFormOptions('preview-form-options')}>
            {busy ? 'Loading…' : 'Preview choices'}
          </button>
        </div>
        {formPreview && (
          <div style={{ marginTop: 14 }}>
            <p style={{ margin: '0 0 10px', fontSize: 13 }}>
              Found <b>{formPreview.questionCount}</b> award categories and <b>{formPreview.optionCount}</b> choices.
            </p>
            <ul style={{ margin: '0 0 12px', paddingLeft: 20, display: 'grid', gap: 5 }}>
              {formPreview.questions.map((question) => (
                <li key={question.slug}>
                  <b>{question.title}</b> — {question.optionCount} choices
                  {question.isRequired ? ' · required' : ' · optional'}
                  {question.shuffleOptions ? ' · shuffled for voters' : ''}
                  {question.allowWriteIn ? ' · includes write-in' : ''}
                  {question.examples.length > 0 && <span className="muted"> · {question.examples.join(', ')}{question.optionCount > question.examples.length ? ', …' : ''}</span>}
                </li>
              ))}
            </ul>
            <button className="btn btn-sm" disabled={busy} onClick={() => handleFormOptions('import-form-options')}>
              Import these choices
            </button>
          </div>
        )}
      </section>

      <div style={{ display: 'grid', gap: 18, marginTop: 20 }}>
        {categories.map((c) => (
          <div key={c.id} className="forum-list" style={{ padding: 16 }}>
            <strong>{c.name}</strong>
            <span className="muted" style={{ marginLeft: 10, fontSize: 12.5 }}>
              {c.is_required ? 'Required question' : 'Optional question'}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                <input
                  type="checkbox"
                  checked={c.shuffle_options_override ?? c.shuffle_options}
                  disabled={busy}
                  onChange={(event) => call({
                    action: 'set-category-shuffle-override',
                    cycleId,
                    categoryId: c.id,
                    shuffleOptions: event.target.checked,
                  })}
                />
                Shuffle nominee options for voters
              </label>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Google Form setting: {c.shuffle_options ? 'shuffle on' : 'shuffle off'}
                {c.shuffle_options_override !== null ? ' · admin override active' : ''}
              </span>
              {c.shuffle_options_override !== null && (
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={busy}
                  onClick={() => call({ action: 'set-category-shuffle-override', cycleId, categoryId: c.id, shuffleOptions: null })}
                >
                  Use Google Form setting
                </button>
              )}
            </div>
            <ul style={{ margin: '10px 0', paddingLeft: 18 }}>
              {c.nominees.map((n) => (
                <li key={n.id} style={{ marginBottom: 4 }}>
                  {n.name}
                  <button className="btn btn-sm btn-ghost" style={{ marginLeft: 10, padding: '2px 8px' }} disabled={busy} onClick={() => call({ action: 'remove-nominee', nomineeId: n.id })}>Remove</button>
                </li>
              ))}
              {c.nominees.length === 0 && <li style={{ color: 'var(--muted)' }}>No nominees yet.</li>}
            </ul>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input
                placeholder="Nominee name"
                value={newNominee[c.id] ?? ''}
                onChange={(e) => setNewNominee((s) => ({ ...s, [c.id]: e.target.value }))}
                style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text)' }}
              />
              <button className="btn btn-sm" disabled={busy || !newNominee[c.id]?.trim()} onClick={() => { call({ action: 'add-nominee', categoryId: c.id, name: newNominee[c.id] }); setNewNominee((s) => ({ ...s, [c.id]: '' })); }}>Add</button>
            </div>
            <details>
              <summary style={{ cursor: 'pointer', color: 'var(--soft)', fontSize: 13 }}>Import previous Google Form votes from CSV</summary>
              <div style={{ marginTop: 10 }}>
                <textarea
                  placeholder="handle,nominee name"
                  value={csv[c.id] ?? ''}
                  onChange={(e) => setCsv((s) => ({ ...s, [c.id]: e.target.value }))}
                  style={{ width: '100%', minHeight: 70, marginTop: 10, padding: 8, borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text)' }}
                />
                <button className="btn btn-sm" disabled={busy || !csv[c.id]?.trim()} onClick={() => call({ action: 'import-csv', categoryId: c.id, csv: csv[c.id] })} style={{ marginTop: 8 }}>Import</button>
              </div>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
