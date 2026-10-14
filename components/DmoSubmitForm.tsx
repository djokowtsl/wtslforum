'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type CSSProperties } from 'react';

export default function DmoSubmitForm() {
  const router = useRouter();
  const [tournament, setTournament] = useState('');
  const [roundName, setRoundName] = useState('');
  const [player1, setPlayer1] = useState('');
  const [player2, setPlayer2] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!tournament.trim() || !roundName.trim() || !player1.trim() || !player2.trim()) {
      setError('Enter the tournament, round, and both players.');
      return;
    }
    if (!file && !externalUrl.trim()) {
      setError('Attach a .dmo file or add a recording link.');
      return;
    }
    if (file && !file.name.toLowerCase().endsWith('.dmo')) {
      setError('Choose a .dmo match recording.');
      return;
    }
    if (file && file.size > 20 * 1024 * 1024) {
      setError('The file is too large (20MB max).');
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append('tournament', tournament);
      form.append('round', roundName);
      form.append('player1', player1);
      form.append('player2', player2);
      form.append('externalUrl', externalUrl.trim());
      if (file) form.append('file', file);

      const response = await fetch('/api/dmo-submissions', { method: 'POST', body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'The DMO submission failed.');

      setTournament('');
      setRoundName('');
      setPlayer1('');
      setPlayer2('');
      setExternalUrl('');
      setFile(null);
      setFileInputKey((value) => value + 1);
      setNotice(
        data.discordDelivered
          ? 'Submitted to the private Forum admin store and the Discord DMO admin channel.'
          : data.message || 'Saved privately for Forum admins.',
      );
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The DMO submission failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-card">
      <h3>Submit a match recording</h3>
      <p className="notice" style={{ marginBottom: 14 }}>
        Add the tournament, round, and players, then attach a .dmo file or provide a recording link.
        Submissions are kept private for admins and are also sent to the Discord DMO admin channel.
      </p>
      {error && <div className="notice" role="alert" style={{ borderColor: '#ffb3bb', marginBottom: 14 }}>{error}</div>}
      {notice && <div className="notice" role="status" style={{ marginBottom: 14 }}>{notice}</div>}
      <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
        <input
          required
          maxLength={100}
          placeholder="Tournament"
          value={tournament}
          onChange={(event) => setTournament(event.target.value)}
          style={inputStyle}
        />
        <input
          required
          maxLength={60}
          placeholder="Round (e.g. Final)"
          value={roundName}
          onChange={(event) => setRoundName(event.target.value)}
          style={inputStyle}
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <input
            required
            maxLength={100}
            placeholder="Player 1"
            value={player1}
            onChange={(event) => setPlayer1(event.target.value)}
            style={inputStyle}
          />
          <input
            required
            maxLength={100}
            placeholder="Player 2"
            value={player2}
            onChange={(event) => setPlayer2(event.target.value)}
            style={inputStyle}
          />
        </div>
        <input
          type="url"
          maxLength={1000}
          placeholder="Recording link (optional if a file is attached)"
          value={externalUrl}
          onChange={(event) => setExternalUrl(event.target.value)}
          style={inputStyle}
        />
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Or attach a .dmo file (20MB max)</span>
          <input
            key={fileInputKey}
            type="file"
            accept=".dmo,application/octet-stream"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <button className="btn btn-sm" type="submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit recording'}
        </button>
      </form>
    </section>
  );
}

const inputStyle: CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--line-2)',
  background: 'var(--bg-2)',
  color: 'var(--text)',
};
