'use client';
import { useState } from 'react';
import { TOURS, type TourCode } from '@/lib/wtsl';

export default function PlayerClaimForm() {
  const [wtslPlayerId, setWtslPlayerId] = useState('');
  const [tour, setTour] = useState<TourCode>(TOURS[0].code);
  const [playerName, setPlayerName] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    setMessage('');
    try {
      const r = await fetch('/api/profile/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wtsl_player_id: wtslPlayerId, tour, player_name: playerName, note }),
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
      <p className="notice">
        Found your ID on your official WTSL player page URL, e.g. <code>player_page.php?player=1105</code> → ID is <code>1105</code>.
      </p>
      <label>Tour
        <select value={tour} onChange={(e) => setTour(e.target.value as TourCode)}>
          {TOURS.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </select>
      </label>
      <label>Your WTSL player ID
        <input value={wtslPlayerId} onChange={(e) => setWtslPlayerId(e.target.value)} placeholder="1105" required />
      </label>
      <label>Player name (as shown on WTSL)
        <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="e.g. Novak Djokovic" required />
      </label>
      <label>Note for the admin (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything that helps us confirm it's you" />
      </label>
      {message && state === 'error' && <p className="notice" style={{ color: '#ff6b6b' }}>{message}</p>}
      <button className="btn btn-sm" disabled={state === 'sending'}>{state === 'sending' ? 'Submitting…' : 'Submit for verification'}</button>
    </form>
  );
}
