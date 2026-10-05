'use client';
import { useEffect, useRef, useState } from 'react';
import { tourLabel, type TourCode } from '@/lib/wtsl';
import { exactPlayerNameMatches } from '@/lib/playerClaimSearch';
import PlayerAvatar from '@/components/PlayerAvatar';

type PlayerHit = { wtsl_player_id: string; name: string; avatar_url: string | null; flag_url: string | null; country: string | null };

export default function PlayerClaimForm({ tour }: { tour: TourCode }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlayerHit[]>([]);
  const [selected, setSelected] = useState<PlayerHit | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setSearching(true);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/players/search?tour=${encodeURIComponent(tour)}&q=${encodeURIComponent(query.trim())}`);
        const data = await r.json();
        setResults(data.ok ? data.results : []);
        setActiveIndex(-1);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, selected, tour]);

  // Close the dropdown on an outside click, same as any typable combobox.
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  function pick(p: PlayerHit) {
    setSelected(p);
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < results.length) {
        e.preventDefault();
        pick(results[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    setMessage('');
    try {
      let player = selected;
      if (!player) {
        const typedName = query.trim();
        if (typedName.length < 2) {
          setState('error');
          setMessage('Type your full player name or choose a player from the suggestions.');
          return;
        }

        const searchResponse = await fetch(
          `/api/players/search?tour=${encodeURIComponent(tour)}&q=${encodeURIComponent(typedName)}`,
        );
        const searchData = await searchResponse.json();
        if (!searchResponse.ok || !searchData.ok || !Array.isArray(searchData.results)) {
          throw new Error('Could not search players. Please try again.');
        }

        const candidates = searchData.results as PlayerHit[];
        const exactMatches = exactPlayerNameMatches(candidates, typedName);
        if (exactMatches.length !== 1) {
          setResults(candidates);
          setOpen(candidates.length > 0);
          setState('error');
          setMessage(
            exactMatches.length > 1
              ? 'More than one player has that exact name. Choose your player from the suggestions.'
              : 'No exact player-name match. Choose your player from the suggestions or check the spelling.',
          );
          return;
        }
        player = exactMatches[0];
      }

      const r = await fetch('/api/profile/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wtsl_player_id: player.wtsl_player_id, tour, player_name: player.name, note }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setState('error');
        setMessage(data.error || 'Could not submit claim.');
        return;
      }
      setState('sent');
      setMessage('Submitted — an admin will review it before your account is marked as verified.');
    } catch {
      setState('error');
      setMessage('Request failed. Try again.');
    }
  }

  if (state === 'sent') return <p className="notice">{message}</p>;

  return (
    <form onSubmit={submit} className="compose">
      <label>Find yourself in {tourLabel(tour)}
        {selected ? (
          <div className="player-line claim-selected-box" style={{ marginTop: '.4rem' }}>
            <PlayerAvatar src={selected.avatar_url} flagSrc={selected.flag_url} flagLabel={selected.country} name={selected.name} size={34} />
            <span>✓ {selected.name}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setSelected(null); setQuery(''); }}>Change</button>
          </div>
        ) : (
          <div className="claim-combobox" ref={boxRef}>
            <input
              role="combobox"
              aria-expanded={open}
              aria-controls={`claim-search-list-${tour}`}
              aria-autocomplete="list"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setState('idle');
                setMessage('');
              }}
              onFocus={() => { if (query.trim().length >= 2) setOpen(true); }}
              onKeyDown={onKeyDown}
              placeholder="Type your full name or choose a suggestion…"
              disabled={state === 'sending'}
              autoComplete="off"
            />
            {open && query.trim().length >= 2 && (
              <div className="claim-search-results" id={`claim-search-list-${tour}`} role="listbox">
                {searching && <div className="claim-search-hint">Searching…</div>}
                {!searching && results.length === 0 && <div className="claim-search-hint">No matching players on this tour.</div>}
                {results.map((p, i) => (
                  <button
                    type="button"
                    key={p.wtsl_player_id}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={`claim-search-row${i === activeIndex ? ' active' : ''}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => pick(p)}
                  >
                    <PlayerAvatar src={p.avatar_url} flagSrc={p.flag_url} flagLabel={p.country} name={p.name} size={26} />
                    <span>{p.name}{p.country ? ` · ${p.country}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </label>
      <label>Note for the admin (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything that helps us confirm it's you" disabled={state === 'sending'} />
      </label>
      {message && state === 'error' && <p className="notice" style={{ color: '#ff6b6b' }}>{message}</p>}
      <button className="btn btn-sm" disabled={state === 'sending'}>{state === 'sending' ? 'Submitting…' : 'Submit for verification'}</button>
    </form>
  );
}
