'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, LoaderCircle } from 'lucide-react';
import { CATEGORY_ICONS } from '@/lib/awardIcons';
import { getAwardShuffleSetting, shuffleAwardOptions } from '@/lib/awardOptionShuffle';
import { getAwardVoteProgress, getNextUnansweredRequiredCategoryId } from '@/lib/awardVoteProgress';

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
type SaveStatus = 'idle' | 'saving' | 'saved' | 'saved-incomplete' | 'saved-no-sync' | 'saved-pending' | 'saved-review' | 'saved-sync-error' | 'error';

export default function AwardVoteForm({ cycleId, categories, initialVotes, initialFormSubmitted, shuffleSeed }: {
  cycleId: number;
  categories: Category[];
  initialVotes: Record<number, { nomineeId: number | null; writeIn: string | null }>;
  initialFormSubmitted: boolean;
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
  const [ballotSubmitted, setBallotSubmitted] = useState(initialFormSubmitted);
  const [syncNeedsReview, setSyncNeedsReview] = useState(false);
  const progress = getAwardVoteProgress(categories, savedVotes, dirty);

  const pollSyncStatus = useCallback(async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      try {
        const res = await fetch(`/api/awards/vote-status?cycleId=${cycleId}`, { cache: 'no-store' });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.formSyncStatus === 'synced') {
          setBallotSubmitted(true);
          setSyncNeedsReview(false);
          setStatus((current) => {
            const next = { ...current };
            for (const [id, value] of Object.entries(next)) {
              if (value === 'saved-pending' || value === 'saved-review' || value === 'saved-sync-error') {
                next[Number(id)] = 'saved';
              }
            }
            return next;
          });
          return;
        }
        if (data.formSyncStatus === 'needs_review' || data.formSyncStatus === 'retryable') {
          setSyncNeedsReview(true);
          setStatus((current) => Object.fromEntries(Object.entries(current).map(([id, value]) => [
            id,
            value === 'saved-pending' || value === 'saved-sync-error' ? 'saved-review' : value,
          ])) as Record<number, SaveStatus>);
          return;
        }
        if (data.formSyncStatus === 'incomplete') return;
      } catch {
        // A temporary status read failure should leave the saved ballot in its pending state.
      }
    }
  }, [cycleId]);

  useEffect(() => {
    if (progress.isSubmitted && !ballotSubmitted && !Object.values(dirty).some(Boolean)) {
      void pollSyncStatus();
    }
  }, [pollSyncStatus, progress.isSubmitted, ballotSubmitted, dirty]);

  function updateChoice(categoryId: number, choice: { nomineeId: number | null; writeIn: string }) {
    setChoices((current) => ({ ...current, [categoryId]: choice }));
    setDirty((current) => ({ ...current, [categoryId]: true }));
    setStatus((current) => ({ ...current, [categoryId]: 'idle' }));
    setBallotSubmitted(false);
    setSyncNeedsReview(false);
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

      const nextStatus: SaveStatus = data.formSyncStatus === 'synced'
        ? 'saved'
        : data.formSyncStatus === 'incomplete'
          ? 'saved-incomplete'
          : data.formSyncStatus === 'not_configured' || data.formSyncStatus === 'misconfigured'
            ? 'saved-no-sync'
            : data.formSyncStatus === 'needs_review'
              ? 'saved-review'
              : data.formSyncStatus === 'queued' || data.formSyncStatus === 'processing' || data.formSyncStatus === 'retryable'
                ? 'saved-pending'
            : 'saved-sync-error';
      setStatus((current) => ({ ...current, [categoryId]: nextStatus }));
      setSavedVotes((current) => ({ ...current, [categoryId]: true }));
      setDirty((current) => ({ ...current, [categoryId]: false }));
      setBallotSubmitted(data.ballotSubmitted === true);
      setSyncNeedsReview(data.formSyncStatus === 'needs_review');
      if (data.formSyncStatus === 'incomplete') {
        const nextRequiredCategoryId = getNextUnansweredRequiredCategoryId(categories, savedVotes, dirty, categoryId);
        if (nextRequiredCategoryId !== null) {
          window.requestAnimationFrame(() => {
            const nextQuestion = document.getElementById(`award-category-${nextRequiredCategoryId}`);
            nextQuestion?.scrollIntoView({
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
              block: 'start',
            });
          });
        }
      }
    } catch {
      setStatus((current) => ({ ...current, [categoryId]: 'error' }));
    }
  }

  const showSubmitted = progress.isSubmitted && ballotSubmitted;
  const showSyncPending = progress.isSubmitted && !ballotSubmitted && !Object.values(dirty).some(Boolean);
  const completionText = progress.allQuestionsSaved
    ? 'Every question has a saved answer. You can change any choice below.'
    : Object.values(dirty).some(Boolean)
      ? 'Your edits are not saved yet. Save your choices below to update your ballot.'
      : progress.isSubmitted
        ? 'Your ballot is submitted. You can answer remaining questions or update saved choices below.'
        : 'Answer as many questions as you can. Questions marked * must be answered before your ballot can be submitted.';

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
              {progress.savedQuestionCount} of {progress.questionCount} questions answered
            </div>
          </div>
        </div>
        <div
          role="progressbar"
          aria-label="Award questions answered"
          aria-valuemin={0}
          aria-valuemax={Math.max(1, progress.questionCount)}
          aria-valuenow={progress.savedQuestionCount}
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
          Choose an option, then press <b>Save my vote</b>. Questions marked * must be answered before your ballot can be submitted.
        </p>
      </section>

      {showSyncPending && (
        <div role="status" className="notice" style={{ borderColor: '#ffb36b' }}>
          {syncNeedsReview || Object.values(status).includes('saved-review')
            ? 'Your choices are saved, but submission could not be confirmed. Please don’t resubmit; the saved ballot is retained for follow-up.'
            : 'Your choices are saved. Final submission is processing; this page will update when it is confirmed.'}
        </div>
      )}

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
          <section
            className="forum-list"
            id={`award-category-${c.id}`}
            key={c.id}
            style={{ padding: 18, scrollMarginTop: 96 }}
          >
            <div className="award-category-title">
              <span className="award-category-icon" aria-hidden="true">{CATEGORY_ICONS[c.name] ?? '★'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>
                  {c.name}
                  {c.is_required && <span aria-label="Must answer before submitting" title="Must answer before submitting" style={{ marginLeft: 3, color: 'var(--muted)', fontSize: 13, fontWeight: 500 }}>*</span>}
                </strong>
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
                  : buttonText}
              </button>
              <span id={`award-save-help-${c.id}`} style={{ color: 'var(--muted)', fontSize: 13 }}>
                {hasChoice
                  ? dirty[c.id] ? 'This selection is not saved yet.' : 'Your current vote is saved.'
                  : 'Choose an option to add your answer.'}
              </span>
              {categoryStatus === 'saved' && <span role="status" style={{ color: 'var(--lime)', fontSize: 13, fontWeight: 700 }}>Vote saved; ballot submitted.</span>}
              {categoryStatus === 'saved-incomplete' && <span role="status" style={{ color: 'var(--muted)', fontSize: 13 }}>Vote saved. Answer every question marked * to submit the ballot.</span>}
              {categoryStatus === 'saved-no-sync' && <span role="status" style={{ color: 'var(--muted)', fontSize: 13 }}>Vote saved.</span>}
              {categoryStatus === 'saved-pending' && <span role="status" style={{ color: 'var(--muted)', fontSize: 13 }}>Vote saved; submission is processing.</span>}
              {categoryStatus === 'saved-review' && <span role="status" style={{ color: '#ffb36b', fontSize: 13 }}>Vote saved; submission is being checked.</span>}
              {categoryStatus === 'saved-sync-error' && <span role="status" style={{ color: '#ffb36b', fontSize: 13 }}>Vote saved; submission is not confirmed.</span>}
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
