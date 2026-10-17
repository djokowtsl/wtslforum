'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

type DmoSubmissionTagEditorProps = {
  id: number;
  tournament: string;
  roundName: string;
  player1: string;
  player2: string;
  submissionDate: string;
};

export default function DmoSubmissionTagEditor({
  id,
  tournament,
  roundName,
  player1,
  player2,
  submissionDate,
}: DmoSubmissionTagEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tags, setTags] = useState({
    tournament,
    roundName,
    player1,
    player2,
    submissionDate,
  });

  useEffect(() => {
    setTags({ tournament, roundName, player1, player2, submissionDate });
  }, [tournament, roundName, player1, player2, submissionDate]);

  function cancelEdit() {
    setTags({ tournament, roundName, player1, player2, submissionDate });
    setError('');
    setEditing(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/dmo-submissions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tags),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'DMO tags could not be saved.');
      setTags({
        tournament: tags.tournament.trim(),
        roundName: tags.roundName.trim(),
        player1: tags.player1.trim(),
        player2: tags.player2.trim(),
        submissionDate: tags.submissionDate,
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
        {editing ? 'Close tag editor' : 'Edit tags'}
      </button>
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
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save tags'}
            </button>
            <button className="btn btn-sm btn-ghost" type="button" onClick={cancelEdit} disabled={busy}>
              Cancel
            </button>
          </div>
          {error && <p role="alert" className="notice">{error}</p>}
        </form>
      )}
    </div>
  );
}
