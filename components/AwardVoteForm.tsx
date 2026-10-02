'use client';

import { useState } from 'react';

type Nominee = { id: number; name: string };
type Category = { id: number; name: string; description: string; allow_write_in: boolean; nominees: Nominee[] };

export default function AwardVoteForm({ categories, initialVotes }: { categories: Category[]; initialVotes: Record<number, { nomineeId: number | null; writeIn: string | null }> }) {
  const [choices, setChoices] = useState<Record<number, { nomineeId: number | null; writeIn: string }>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, { nomineeId: initialVotes[c.id]?.nomineeId ?? null, writeIn: initialVotes[c.id]?.writeIn ?? '' }]))
  );
  const [status, setStatus] = useState<Record<number, 'idle' | 'saving' | 'saved' | 'error'>>({});

  async function vote(categoryId: number) {
    const choice = choices[categoryId];
    setStatus((s) => ({ ...s, [categoryId]: 'saving' }));
    try {
      const res = await fetch('/api/awards/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoryId, nomineeId: choice.nomineeId, writeIn: choice.nomineeId ? null : choice.writeIn }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Vote failed');
      setStatus((s) => ({ ...s, [categoryId]: 'saved' }));
    } catch {
      setStatus((s) => ({ ...s, [categoryId]: 'error' }));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {categories.map((c) => (
        <div className="forum-list" key={c.id} style={{ padding: 16 }}>
          {c.name === 'Farmer of the Year' ? (
            <strong className="award-vote-farmer-pill">
              <span>{c.name}</span>
              <span className="award-farmer-corn" role="img" aria-label="Corn">🌽</span>
            </strong>
          ) : (
            <strong>{c.name}</strong>
          )}
          {c.description && <p style={{ margin: '4px 0 10px', color: 'var(--muted)', fontSize: 13.5 }}>{c.description}</p>}
          <div style={{ display: 'grid', gap: 6, margin: '10px 0' }}>
            {c.nominees.map((n) => (
              <label key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="radio"
                  name={`award-${c.id}`}
                  checked={choices[c.id]?.nomineeId === n.id}
                  onChange={() => setChoices((s) => ({ ...s, [c.id]: { nomineeId: n.id, writeIn: s[c.id]?.writeIn ?? '' } }))}
                />
                {n.name}
              </label>
            ))}
            {c.allow_write_in && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="radio"
                  name={`award-${c.id}`}
                  checked={!choices[c.id]?.nomineeId && !!choices[c.id]?.writeIn}
                  onChange={() => setChoices((s) => ({ ...s, [c.id]: { nomineeId: null, writeIn: s[c.id]?.writeIn ?? '' } }))}
                />
                Write in:
                <input
                  type="text"
                  placeholder="Type a name"
                  value={choices[c.id]?.writeIn ?? ''}
                  onChange={(e) => setChoices((s) => ({ ...s, [c.id]: { nomineeId: null, writeIn: e.target.value } }))}
                  style={{ flex: 1, padding: '5px 10px', borderRadius: 8, border: '1px solid var(--line-2)', background: 'var(--bg-2)', color: 'var(--text)' }}
                />
              </label>
            )}
          </div>
          <button
            className="btn btn-sm"
            disabled={status[c.id] === 'saving' || (!choices[c.id]?.nomineeId && !choices[c.id]?.writeIn.trim())}
            onClick={() => vote(c.id)}
          >
            {initialVotes[c.id] ? 'Update vote' : 'Vote'}
          </button>
          {status[c.id] === 'saved' && <span style={{ marginLeft: 10, color: 'var(--lime)' }}>Saved ✓</span>}
          {status[c.id] === 'error' && <span style={{ marginLeft: 10, color: '#ff8f9a' }}>Couldn&apos;t save, try again.</span>}
        </div>
      ))}
    </div>
  );
}
