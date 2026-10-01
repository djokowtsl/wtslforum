'use client';
import { useState } from 'react';

export default function ChallongeClaimForm() {
  const [username, setUsername] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setState('sending');
    setMessage('');
    try {
      const r = await fetch('/api/profile/claim-challonge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challonge_username: username.trim(), note }),
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
      <label>Your Challonge username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. Squeaky94"
          autoComplete="off"
        />
      </label>
      <label>Note for the admin (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything that helps us confirm it's you" />
      </label>
      {message && state === 'error' && <p className="notice" style={{ color: '#ff6b6b' }}>{message}</p>}
      <button className="btn btn-sm" disabled={state === 'sending' || !username.trim()}>{state === 'sending' ? 'Submitting…' : 'Submit for verification'}</button>
    </form>
  );
}
