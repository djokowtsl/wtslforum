'use client';

import { useState } from 'react';
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

export default function AwardAdminPanel({ cycleId, votingOpen, categories, sheetSyncConfigured = false }: { cycleId: number; votingOpen: boolean; categories: Category[]; sheetSyncConfigured?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [newNominee, setNewNominee] = useState<Record<number, string>>({});
  const [csv, setCsv] = useState<Record<number, string>>({});
  const [err, setErr] = useState('');
  const [sheetSyncMessage, setSheetSyncMessage] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formPreview, setFormPreview] = useState<FormPreview | null>(null);
  const [formMessage, setFormMessage] = useState('');

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

  async function syncVotesToSheet() {
    setBusy(true);
    setErr('');
    setSheetSyncMessage('');
    let afterVoteId = '0';
    try {
      while (true) {
        const res = await fetch('/api/admin/awards', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'sync-sheet-batch', cycleId, afterVoteId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not sync Forum votes.');
        afterVoteId = String(data.nextAfterVoteId ?? afterVoteId);
        setSheetSyncMessage('Syncing Forum votes to Google Sheets…');
        if (data.done) break;
      }
      setSheetSyncMessage('Forum vote sync completed.');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not sync Forum votes.');
    } finally {
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
        <h4 id="award-sheet-sync-title" style={{ margin: '0 0 6px' }}>Google Sheets vote sync</h4>
        <p className="muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
          {sheetSyncConfigured
            ? 'Forum votes are copied without Discord IDs to a separate “Forum Votes” tab. Use this to backfill votes or retry a failed sync.'
            : 'The Apps Script bridge and Vercel settings are not configured yet. Forum voting remains available; votes will not reach the spreadsheet until setup is complete.'}
        </p>
        <button className="btn btn-sm" disabled={busy || !sheetSyncConfigured} onClick={syncVotesToSheet}>
          {busy ? 'Syncing…' : 'Sync Forum votes now'}
        </button>
        {sheetSyncMessage && <p role="status" style={{ margin: '10px 0 0', fontSize: 13 }}>{sheetSyncMessage}</p>}
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
