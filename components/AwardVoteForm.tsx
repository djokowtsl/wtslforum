'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle, Send } from 'lucide-react';
import { CATEGORY_ICONS } from '@/lib/awardIcons';
import { getAwardShuffleSetting, shuffleAwardOptions } from '@/lib/awardOptionShuffle';
import { getAwardVoteProgress } from '@/lib/awardVoteProgress';

type Nominee = { id: number; name: string };
type Category = {
  id: number;
  name: string;
  description: string;
  allow_write_in: boolean;
  shuffle_options: boolean;
  shuffle_options_override: boolean | null;
  is_required: boolean;
  nominees: Nominee[];
};
type SaveStatus = 'idle' | 'saving' | 'saved' | 'saved-no-sync' | 'saved-sync-error' | 'error';

export default function AwardVoteForm({ categories, initialVotes, shuffleSeed }: {
  categories: Category[];
  initialVotes: Record<number, { nomineeId: number | null; writeIn: string | null }>;
  shuffleSeed: string;
}) {
  const displayCategories = useMemo(() => categories.map((category) => ({
    ...category,
    nominees: getAwardShuffleSetting(category)
      ? shuffleAwardOptions(category.nominees, `${shuffleSeed}:${category.id}`)
      : category.nominees,
  })), [categories, shuffleSeed]);
  const [choices, setChoices] = useState<Record<number, { nomineeId: number | null; writeIn: string }>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, { nomineeId: initialVotes[c.id]?.nomineeId ?? null, writeIn: initialVotes[c.id]?.writeIn ?? '' }]))
  );
  const [status, setStatus] = useState<Record<number, SaveStatus>>({});
  const [savedVotes, setSavedVotes] = useState<Record<number, boolean>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, Boolean(initialVotes[c.id])]))
  );
  const [dirty, setDirty] = useState<Record<number, boolean>>({});
  const progress = getAwardVoteProgress(categories, savedVotes, dirty);

  function updateChoice(categoryId: number, choice: { nomineeId: number | null; writeIn: string }) {
    setChoices((current) => ({ ...current, [categoryId]: choice }));
    setDirty((current) => ({ ...current, [categoryId]: true }));
    setStatus((current) => ({ ...current, [categoryId]: 'idle' }));
  }

  async function vote(categoryId: number) {
    const choice = choices[categoryId];
    setStatus((current) => ({ ...current, [categoryId]: 'saving' }));
    try {
      const res = await fetch('/api/awards/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoryId, nomineeId: choice.nomineeId, writeIn: choice.nomineeId ? null : choice.writeIn }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Vote failed');

      const nextStatus: SaveStatus = data.sheetSyncStatus === 'synced'
        ? 'saved'
        : data.sheetSyncStatus === 'not_configured' || data.sheetSyncStatus === 'misconfigured'
          ? 'saved-no-sync'
          : 'saved-sync-error';
      setStatus((current) => ({ ...current, [categoryId]: nextStatus }));
      setSavedVotes((current) => ({ ...current, [categoryId]: true }));
      setDirty((current) => ({ ...current, [categoryId]: false }));
    } catch {
      setStatus((current) => ({ ...current, [categoryId]: 'error' }));
    }
  }

  const requiredCategories = categories.filter((category) => category.is_required);
  const optionalCategories = categories.filter((category) => !category.is_required);
  const showSubmitted = progress.isSubmitted;
  const completionText = progress.allQuestionsSaved
    ? 'Every question has a saved vote. You can change any choice below and save it again.'
    : Object.values(dirty).some(Boolean)
      ? 'Your required votes are saved. Save any changes below to update your ballot.'
      : 'Your required votes are saved. Optional questions can be left blank or answered later.';

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section
        aria-label="Awards ballot progress"
        style={{
          padding: '18px 20px',
          border: '1px solid var(--line)',
          borderRadius: 14,
          background: 'linear-gradient(110deg, rgba(176,244,59,.1), transparent 72%), var(--panel)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>
              Awards ballot
            </div>
            <div style={{ marginTop: 5, fontSize: 16, fontWeight: 700 }}>
              {requiredCategories.length > 0
                ? `${progress.requiredSavedCount} of ${requiredCategories.length} required questions saved`
                : `${progress.optionalSavedCount} of ${optionalCategories.length} optional questions answered`}
            </div>
          </div>
          {optionalCategories.length > 0 && (
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>
              {progress.optionalSavedCount} of {optionalCategories.length} optional answered
            </span>
          )}
        </div>
        <div
          role="progressbar"
          aria-label={requiredCategories.length > 0 ? 'Required award questions saved' : 'Optional award questions answered'}
          aria-valuemin={0}
          aria-valuemax={Math.max(1, requiredCategories.length || optionalCategories.length)}
          aria-valuenow={requiredCategories.length > 0 ? progress.requiredSavedCount : progress.optionalSavedCount}
          style={{ height: 6, marginTop: 14, overflow: 'hidden', borderRadius: 10, background: 'var(--panel-3)' }}
        >
          <div style={{
            width: `${progress.completionPercentage}%`,
            height: '100%',
            borderRadius: 10,
            background: 'var(--lime)',
            transition: 'width .2s ease',
          }} />
        </div>
        <p style={{ margin: '12px 0 0', color: 'var(--soft)', fontSize: 13 }}>
          Choose an option, then press <b>Save my vote</b>. Your choice is not saved until you press the button.
        </p>
      </section>

      {showSubmitted && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: 18,
            border: '1px solid rgba(176,244,59,.35)',
            borderRadius: 14,
            background: 'rgba(176,244,59,.08)',
          }}
        >
          <CheckCircle2 size={22} color="var(--lime)" aria-hidden="true" style={{ flex: 'none' }} />
          <div>
            <strong style={{ display: 'block', fontSize: 17 }}>Ballot submitted</strong>
            <span style={{ display: 'block', marginTop: 4, color: 'var(--soft)', fontSize: 13 }}>{completionText}</span>
          </div>
        </div>
      )}

      {displayCategories.map((c) => {
        const choice = choices[c.id];
        const categoryStatus = status[c.id] ?? 'idle';
        const hasChoice = Boolean(choice?.nomineeId || choice?.writeIn.trim());
        const voteIsSaved = Boolean(savedVotes[c.id]) && !dirty[c.id];
        const buttonText = savedVotes[c.id] ? 'Update my vote' : 'Save my vote';

        return (
          <section className="forum-list" key={c.id} style={{ padding: 18 }}>
            <div className="award-category-title">
              <span className="award-category-icon" aria-hidden="true">{CATEGORY_ICONS[c.name] ?? '★'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{c.name}</strong>
                <div style={{
                  display: 'inline-flex',
                  marginTop: 7,
                  padding: '4px 8px',
                  border: `1px solid ${c.is_required ? 'rgba(34,194,218,.35)' : 'var(--line-2)'}`,
                  borderRadius: 999,
                  color: c.is_required ? 'var(--cyan)' : 'var(--muted)',
                  fontSize: 10.5,
                  fontWeight: 800,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                }}>
                  {c.is_required ? 'Required' : 'Optional'}
                </div>
              </div>
              {voteIsSaved && <CheckCircle2 size={20} color="var(--lime)" aria-label="Vote saved" style={{ flex: 'none' }} />}
            </div>
            {c.description && <p style={{ margin: '4px 0 10px', color: 'var(--muted)', fontSize: 13.5 }}>{c.description}</p>}
            <div style={{ display: 'grid', gap: 8, margin: '12px 0 16px' }}>
              {c.nominees.map((n) => {
                const selected = choice?.nomineeId === n.id;
                return (
                  <label
                    key={n.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 42,
                      padding: '8px 12px',
                      border: `1px solid ${selected ? 'rgba(176,244,59,.55)' : 'var(--line-2)'}`,
                      borderRadius: 10,
                      background: selected ? 'rgba(176,244,59,.08)' : 'var(--bg-2)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name={`award-${c.id}`}
                      checked={selected}
                      onChange={() => updateChoice(c.id, { nomineeId: n.id, writeIn: choice?.writeIn ?? '' })}
                    />
                    {n.name}
                  </label>
                );
              })}
              {c.allow_write_in && (
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  minHeight: 42,
                  padding: '8px 12px',
                  border: `1px solid ${!choice?.nomineeId && choice?.writeIn ? 'rgba(176,244,59,.55)' : 'var(--line-2)'}`,
                  borderRadius: 10,
                  background: !choice?.nomineeId && choice?.writeIn ? 'rgba(176,244,59,.08)' : 'var(--bg-2)',
                }}>
                  <input
                    type="radio"
                    name={`award-${c.id}`}
                    checked={!choice?.nomineeId && Boolean(choice?.writeIn)}
                    onChange={() => updateChoice(c.id, { nomineeId: null, writeIn: choice?.writeIn ?? '' })}
                  />
                  <span>Write in:</span>
                  <input
                    type="text"
                    placeholder="Type a name"
                    value={choice?.writeIn ?? ''}
                    onChange={(event) => updateChoice(c.id, { nomineeId: null, writeIn: event.target.value })}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '7px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--line-2)',
                      background: 'var(--panel)',
                      color: 'var(--text)',
                    }}
                  />
                </label>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button
                className="btn btn-primary"
                disabled={categoryStatus === 'saving' || !hasChoice}
                onClick={() => vote(c.id)}
                aria-describedby={`award-save-help-${c.id}`}
                style={{
                  minWidth: 196,
                  minHeight: 46,
                  padding: '12px 20px',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 800,
                  opacity: categoryStatus === 'saving' || !hasChoice ? 0.62 : 1,
                  cursor: categoryStatus === 'saving' || !hasChoice ? 'not-allowed' : 'pointer',
                  boxShadow: hasChoice ? '0 8px 22px rgba(176,244,59,.16)' : 'none',
                }}
              >
                {categoryStatus === 'saving'
                  ? <><LoaderCircle size={17} className="animate-spin" /> Saving…</>
                  : <><Send size={16} aria-hidden="true" /> {buttonText}</>}
              </button>
              <span id={`award-save-help-${c.id}`} style={{ color: 'var(--muted)', fontSize: 13 }}>
                {hasChoice
                  ? dirty[c.id] ? 'This selection is not saved yet.' : 'Your current vote is saved.'
                  : c.is_required ? 'Choose an option to save your required vote.' : 'Choose an option to answer, or leave this optional question blank.'}
              </span>
              {categoryStatus === 'saved' && <span role="status" style={{ color: 'var(--lime)', fontSize: 13, fontWeight: 700 }}>Vote saved</span>}
              {categoryStatus === 'saved-no-sync' && <span role="status" style={{ color: 'var(--muted)', fontSize: 13 }}>Vote saved to the Forum. Spreadsheet sync is not configured yet.</span>}
              {categoryStatus === 'saved-sync-error' && <span role="status" style={{ color: '#ffb36b', fontSize: 13 }}>Vote saved to the Forum, but spreadsheet sync failed. An admin can retry it.</span>}
              {categoryStatus === 'error' && (
                <span role="alert" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#ff8f9a', fontSize: 13 }}>
                  <CircleAlert size={16} aria-hidden="true" /> Couldn&apos;t save your vote. Please try again.
                </span>
              )}
              {categoryStatus === 'idle' && voteIsSaved && (
                <span role="status" style={{ color: 'var(--lime)', fontSize: 13, fontWeight: 700 }}>Saved</span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
