'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import DmoSubmissionPlayerStyleEditor, { type DmoPlayerStyleValues } from './DmoSubmissionPlayerStyleEditor';

type DmoSubmissionTagEditorProps = {
  id: number;
  tournament: string;
  roundName: string;
  player1: string;
  player2: string;
  submissionDate: string;
  coachShareUrl?: string | null;
  coachGroupShareConsent: boolean;
  externalUrl?: string | null;
} & Partial<DmoPlayerStyleValues>;

export default function DmoSubmissionTagEditor({
  id,
  tournament,
  roundName,
  player1,
  player2,
  submissionDate,
  coachShareUrl = '',
  coachGroupShareConsent,
  externalUrl = '',
  player1Character = '',
  player2Character = '',
  player1Handedness = '',
  player2Handedness = '',
  player1BackhandType = '',
  player2BackhandType = '',
}: DmoSubmissionTagEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const playerStyle = {
    player1Character, player2Character, player1Handedness, player2Handedness,
    player1BackhandType, player2BackhandType,
  };
  const [tags, setTags] = useState({
    tournament,
    roundName,
    player1,
    player2,
    submissionDate,
    coachShareUrl: coachShareUrl ?? '',
    externalUrl: externalUrl ?? '',
    ...playerStyle,
  });

  useEffect(() => {
    setTags({
      tournament,
      roundName,
      player1,
      player2,
      submissionDate,
      coachShareUrl: coachShareUrl ?? '',
      externalUrl: externalUrl ?? '',
      player1Character, player2Character, player1Handedness, player2Handedness,
      player1BackhandType, player2BackhandType,
    });
  }, [tournament, roundName, player1, player2, submissionDate, coachShareUrl, externalUrl,
    player1Character, player2Character, player1Handedness, player2Handedness,
    player1BackhandType, player2BackhandType]);

  function cancelEdit() {
    setTags({
      tournament,
      roundName,
      player1,
      player2,
      submissionDate,
      coachShareUrl: coachShareUrl ?? '',
      externalUrl: externalUrl ?? '',
      ...playerStyle,
    });
    setError('');
    setNotice('');
    setEditing(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/admin/dmo-submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...tags,
          coachShareUrl: tags.coachShareUrl.trim() || null,
          externalUrl: tags.externalUrl.trim() || null,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'DMO tags could not be saved.');
      if (body?.coachGroupConsentReset) {
        setNotice('Coach match link changed. The prior group consent no longer applies; ask the submitter to consent to this link.');
      } else if (body?.coachGroupSync === 'synced') {
        setNotice('Tags saved and the public Coach group was updated.');
      } else if (body?.coachGroupSync === 'failed') {
        setNotice('Tags saved, but the public Coach group could not be updated.');
      } else if (!coachGroupShareConsent && tags.coachShareUrl.trim()) {
        setNotice('Tags saved. Public Coach stats remain blocked until the submitter records group consent.');
      } else if (body?.coachGroupSync === 'not_configured') {
        setNotice('Tags saved. Coach group updates are not configured in this environment.');
      } else {
        setNotice('Tags saved.');
      }
      setTags({
        ...tags,
        tournament: tags.tournament.trim(),
        roundName: tags.roundName.trim(),
        player1: tags.player1.trim(),
        player2: tags.player2.trim(),
        submissionDate: tags.submissionDate,
        coachShareUrl: tags.coachShareUrl.trim(),
        externalUrl: tags.externalUrl.trim(),
      });
      setEditing(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'DMO tags could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '9px 10px',
    border: '1px solid var(--border, #667085)',
    borderRadius: 8,
    background: 'var(--surface, transparent)',
    color: 'inherit',
    font: 'inherit',
  };

  return (
    <div style={{ flexBasis: '100%' }}>
      <button
        className="btn btn-sm btn-ghost"
        type="button"
        onClick={() => {
          setError('');
          setEditing((value) => !value);
        }}
        aria-expanded={editing}
      >
        {editing ? 'Close editor' : 'Edit submission'}
      </button>
      {!editing && tags.coachShareUrl && (
        <p className="notice" style={{ margin: '8px 0 0' }}>
          Public Coach group consent: {coachGroupShareConsent ? 'confirmed' : 'not confirmed'}
        </p>
      )}
      {editing && (
        <form onSubmit={save} style={{ display: 'grid', gap: 10, marginTop: 12, maxWidth: 560 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 5 }}>
              Tournament
              <input
                required
                maxLength={100}
                style={inputStyle}
                value={tags.tournament}
                onChange={(event) => setTags({ ...tags, tournament: event.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 5 }}>
              Round
              <input
                required
                maxLength={60}
                style={inputStyle}
                value={tags.roundName}
                onChange={(event) => setTags({ ...tags, roundName: event.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 5 }}>
              Player 1
              <input
                required
                maxLength={100}
                style={inputStyle}
                value={tags.player1}
                onChange={(event) => setTags({ ...tags, player1: event.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 5 }}>
              Player 2
              <input
                required
                maxLength={100}
                style={inputStyle}
                value={tags.player2}
                onChange={(event) => setTags({ ...tags, player2: event.target.value })}
              />
            </label>
            <label style={{ display: 'grid', gap: 5 }}>
              Submission date
              <input
                required
                type="date"
                style={inputStyle}
                value={tags.submissionDate}
                onChange={(event) => setTags({ ...tags, submissionDate: event.target.value })}
              />
            </label>
          </div>
          <DmoSubmissionPlayerStyleEditor
            value={tags}
            onChange={patch => setTags(current => ({ ...current, ...patch }))}
            inputStyle={inputStyle}
            disabled={busy}
          />
          <label style={{ display: 'grid', gap: 5 }}>
            Recording link
            <input
              type="url"
              maxLength={1000}
              style={inputStyle}
              value={tags.externalUrl}
              onChange={event => setTags({ ...tags, externalUrl: event.target.value })}
            />
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            TE4 Coach match link
            <input
              type="url"
              maxLength={500}
              placeholder="https://replays.knowthew.net/m/…"
              style={inputStyle}
              value={tags.coachShareUrl}
              onChange={(event) => setTags({ ...tags, coachShareUrl: event.target.value })}
            />
            <span className="notice">
              Optional. Links the replay to TE4 Coach. The submitter’s separate consent is required
              before the Coach match appears on the public replay or its stats join the public group;
              Forum replay opt-in alone is not enough.
              Prefer public /m or /tv links; /w dashboard links may require the player’s access.
            </span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save details'}
            </button>
            <button className="btn btn-sm btn-ghost" type="button" onClick={cancelEdit} disabled={busy}>
              Cancel
            </button>
          </div>
          {error && <p role="alert" className="notice">{error}</p>}
        </form>
      )}
      {notice && <p role="status" className="notice">{notice}</p>}
    </div>
  );
}
