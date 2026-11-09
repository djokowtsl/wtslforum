'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type CSSProperties } from 'react';
import FileDropSurface from './FileDropSurface';

export default function DmoSubmitForm() {
  const router = useRouter();
  const [tournament, setTournament] = useState('');
  const [roundName, setRoundName] = useState('');
  const [player1, setPlayer1] = useState('');
  const [player2, setPlayer2] = useState('');
  const [player1Character, setPlayer1Character] = useState('');
  const [player2Character, setPlayer2Character] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [coachShareUrl, setCoachShareUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [publicShareConsent, setPublicShareConsent] = useState(false);
  const [coachGroupShareConsent, setCoachGroupShareConsent] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function selectFile(nextFile: File | null) {
    setPublicShareConsent(false);
    setCoachGroupShareConsent(false);
    if (!nextFile) {
      setFile(null);
      setError('');
      return;
    }
    if (!nextFile.name.toLowerCase().endsWith('.dmo')) {
      setFile(null);
      setFileInputKey((value) => value + 1);
      setError('Choose a .dmo match recording.');
      return;
    }
    if (nextFile.size > 20 * 1024 * 1024) {
      setFile(null);
      setFileInputKey((value) => value + 1);
      setError('The file is too large (20MB max).');
      return;
    }
    setFile(nextFile);
    setError('');
  }

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
      form.append('player1Character', player1Character.trim());
      form.append('player2Character', player2Character.trim());
      form.append('externalUrl', externalUrl.trim());
      form.append('coachShareUrl', coachShareUrl.trim());
      form.append('publicShareConsent', String(publicShareConsent && Boolean(file)));
      form.append(
        'coachGroupShareConsent',
        String(coachGroupShareConsent && Boolean(file) && publicShareConsent && Boolean(coachShareUrl.trim())),
      );
      if (file) form.append('file', file);

      const response = await fetch('/api/dmo-submissions', { method: 'POST', body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'The DMO submission failed.');

      setTournament('');
      setRoundName('');
      setPlayer1('');
      setPlayer2('');
      setPlayer1Character('');
      setPlayer2Character('');
      setExternalUrl('');
      setCoachShareUrl('');
      setFile(null);
      setPublicShareConsent(false);
      setCoachGroupShareConsent(false);
      setFileInputKey((value) => value + 1);
      const savedMessage = data.discordDelivered
        ? 'Submitted to the private Forum admin store and the Discord DMO admin channel.'
        : data.message || 'Saved privately for Forum admins.';
      setNotice(
        data.coachGroupSync === 'failed'
          ? `${savedMessage} The public Coach group could not be updated.`
          : data.coachGroupSync === 'synced'
            ? `${savedMessage} Coach stats were added to the public WTSL group.`
            : savedMessage,
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
        Add the tournament, round, and players, and note the TE4 character each player used. Then attach a .dmo file or provide a recording link.
        For a match played across multiple sessions,{' '}
        <a href="https://replays.knowthew.net/join" target="_blank" rel="noopener noreferrer">
          join the replay parts first
        </a>
        . Use the same two players, keep the sessions in order, and ensure each replay has
        <code> RecordDebugInfo = 1</code>. Check the joined file for repeated or returned points,
        then attach the full-match .dmo.
        The uploaded .dmo file stays private for admins. The first opt-in controls the public Forum
        replay; a separate opt-in controls whether the linked TE4 Coach match and its stats appear
        publicly on the replay and in the WTSL Coach group. Recording links are not published.
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <input
            maxLength={100}
            placeholder="Player 1 character pick (optional)"
            aria-label="Player 1 character pick"
            value={player1Character}
            onChange={(event) => setPlayer1Character(event.target.value)}
            style={inputStyle}
          />
          <input
            maxLength={100}
            placeholder="Player 2 character pick (optional)"
            aria-label="Player 2 character pick"
            value={player2Character}
            onChange={(event) => setPlayer2Character(event.target.value)}
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
        <input
          type="url"
          maxLength={500}
          placeholder="TE4 Coach match link (optional)"
          value={coachShareUrl}
          onChange={(event) => {
            setCoachShareUrl(event.target.value);
            setCoachGroupShareConsent(false);
          }}
          style={inputStyle}
        />
        <FileDropSurface
          onFiles={(files) => selectFile(files[0] ?? null)}
          disabled={busy}
          prompt="Drop a .dmo match recording"
        >
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Or attach or drop a .dmo file (20MB max)</span>
            <input
              key={fileInputKey}
              type="file"
              accept=".dmo,application/octet-stream"
              onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </FileDropSurface>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
          <input
            type="checkbox"
            checked={publicShareConsent}
            disabled={!file}
            onChange={(event) => {
              setPublicShareConsent(event.target.checked);
              if (!event.target.checked) setCoachGroupShareConsent(false);
            }}
            style={{ marginTop: 3 }}
          />
          <span>
            I confirm this is an official WTSL match and both players agree to share its replay publicly.
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
          <input
            type="checkbox"
            checked={coachGroupShareConsent}
            disabled={!file || !publicShareConsent || !coachShareUrl.trim()}
            onChange={(event) => setCoachGroupShareConsent(event.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            Separately, I confirm both players agree to show this linked TE4 Coach match and its
            stats on the public replay page and in the public WTSL Coach group.
          </span>
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
