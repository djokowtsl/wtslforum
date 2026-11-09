'use client';

import { uploadPresigned } from '@vercel/blob/client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import {
  buildDmoSubmissionUploadPath,
  MAX_DMO_SUBMISSION_BYTES,
} from '@/lib/dmoSubmissionUpload';
import {
  isDmoBackhandType,
  isDmoPlayingHand,
  parseDmoSubmissionCharacterRoster,
  type DmoSubmissionCharacterOption,
} from '@/lib/dmoSubmissionPlayerStyle';
import FileDropSurface from './FileDropSurface';

export default function DmoSubmitForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [tournament, setTournament] = useState('');
  const [roundName, setRoundName] = useState('');
  const [player1, setPlayer1] = useState('');
  const [player2, setPlayer2] = useState('');
  const [player1Character, setPlayer1Character] = useState('');
  const [player2Character, setPlayer2Character] = useState('');
  const [player1Handedness, setPlayer1Handedness] = useState('');
  const [player2Handedness, setPlayer2Handedness] = useState('');
  const [player1BackhandType, setPlayer1BackhandType] = useState('');
  const [player2BackhandType, setPlayer2BackhandType] = useState('');
  const [characterOptions, setCharacterOptions] = useState<DmoSubmissionCharacterOption[]>([]);
  const [characterRosterStatus, setCharacterRosterStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [characterRosterRetry, setCharacterRosterRetry] = useState(0);
  const [externalUrl, setExternalUrl] = useState('');
  const [coachShareUrl, setCoachShareUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [publicShareConsent, setPublicShareConsent] = useState(false);
  const [coachGroupShareConsent, setCoachGroupShareConsent] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setCharacterRosterStatus('loading');
    void fetch('/api/character-stats?tour=all&include_profile=false', {
      cache: 'no-store',
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error('The character list is unavailable.');
      return parseDmoSubmissionCharacterRoster(body?.character_filter_metadata);
    }).then((options) => {
      if (!active) return;
      setCharacterOptions(options);
      setCharacterRosterStatus(options.length ? 'ready' : 'error');
    }).catch(() => {
      if (!active) return;
      setCharacterOptions([]);
      setCharacterRosterStatus('error');
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [characterRosterRetry]);

  function updatePlayerCharacter(player: 1 | 2, character: string) {
    const option = characterOptions.find((item) => item.character === character);
    if (player === 1) {
      setPlayer1Character(character);
      setPlayer1Handedness(option?.playingHand ?? '');
      setPlayer1BackhandType(option?.backhandType ?? '');
    } else {
      setPlayer2Character(character);
      setPlayer2Handedness(option?.playingHand ?? '');
      setPlayer2BackhandType(option?.backhandType ?? '');
    }
  }

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
    if (nextFile.size > MAX_DMO_SUBMISSION_BYTES) {
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
    if (
      !isDmoPlayingHand(player1Handedness)
      || !isDmoPlayingHand(player2Handedness)
      || !isDmoBackhandType(player1BackhandType)
      || !isDmoBackhandType(player2BackhandType)
    ) {
      setError('Choose a playing hand and backhand grip for both players.');
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
    if (file && file.size > MAX_DMO_SUBMISSION_BYTES) {
      setError('The file is too large (20MB max).');
      return;
    }

    setBusy(true);
    let temporaryUploadPath: string | null = null;
    try {
      if (file) {
        const uploadId = globalThis.crypto?.randomUUID?.();
        if (!uploadId) throw new Error('Your browser cannot securely prepare this upload. Update the browser and try again.');
        temporaryUploadPath = buildDmoSubmissionUploadPath(userId, uploadId, file.name);
        setUploading(true);
        setUploadProgress(0);
        const uploaded = await uploadPresigned(
          temporaryUploadPath,
          file,
          {
            access: 'private',
            handleUploadUrl: '/api/dmo-submissions/upload',
            contentType: 'application/octet-stream',
            onUploadProgress: ({ percentage }) => setUploadProgress(percentage),
          },
        );
        if (uploaded.pathname !== temporaryUploadPath) {
          throw new Error('The uploaded recording could not be verified. Please try again.');
        }
        setUploading(false);
      }

      const form = new FormData();
      form.append('tournament', tournament);
      form.append('round', roundName);
      form.append('player1', player1);
      form.append('player2', player2);
      form.append('player1Character', player1Character.trim());
      form.append('player2Character', player2Character.trim());
      form.append('player1Handedness', player1Handedness);
      form.append('player2Handedness', player2Handedness);
      form.append('player1BackhandType', player1BackhandType);
      form.append('player2BackhandType', player2BackhandType);
      form.append('externalUrl', externalUrl.trim());
      form.append('coachShareUrl', coachShareUrl.trim());
      form.append('publicShareConsent', String(publicShareConsent && Boolean(file)));
      form.append(
        'coachGroupShareConsent',
        String(coachGroupShareConsent && Boolean(file) && publicShareConsent && Boolean(coachShareUrl.trim())),
      );
      form.append('privateBlobPathname', temporaryUploadPath || '');
      form.append('fileName', file?.name ?? '');

      const response = await fetch('/api/dmo-submissions', { method: 'POST', body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || `The DMO submission failed (HTTP ${response.status}).`);
      }

      temporaryUploadPath = null;
      setTournament('');
      setRoundName('');
      setPlayer1('');
      setPlayer2('');
      setPlayer1Character('');
      setPlayer2Character('');
      setPlayer1Handedness('');
      setPlayer2Handedness('');
      setPlayer1BackhandType('');
      setPlayer2BackhandType('');
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
      if (temporaryUploadPath) {
        await fetch('/api/dmo-submissions/upload', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pathname: temporaryUploadPath }),
        }).catch(() => {});
      }
      setError(cause instanceof Error ? cause.message : 'The DMO submission failed.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setBusy(false);
    }
  }

  return (
    <section className="admin-card">
      <h3>Submit a match recording</h3>
      <p className="notice" style={{ marginBottom: 14 }}>
        Add the tournament, round, and players. Choose each player’s TE4 character to fill in their playing hand and backhand grip, or select no character and enter those details for a created character. Then attach a .dmo file or provide a recording link.
        For a match played across multiple sessions,{' '}
        <a href="https://replays.knowthew.net/join" target="_blank" rel="noopener noreferrer">
          join the replay parts first
        </a>
        . Use the same two players, keep the sessions in order, and ensure each replay has
        <code> RecordDebugInfo = 1</code>. Check the joined file for repeated or returned points,
        then attach the full-match .dmo.
        The Match Replay Center is available to signed-in members and lists all current DMO
        submissions regardless of these share options. Uploaded .dmo files stay in private storage
        and play through the signed-in Forum viewer; recording links are shown to signed-in members.
        Public-share consent remains required for linked TE4 Coach content, and the separate Coach
        consent controls its appearance on public WTSL pages and in the WTSL Coach group.
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
          <fieldset style={playerStyleGroup}>
            <legend>Player 1 style</legend>
            <label style={fieldStyle}>
              TE4 character
              <select
                aria-label="Player 1 character"
                value={player1Character}
                disabled={characterRosterStatus === 'loading'}
                onChange={(event) => updatePlayerCharacter(1, event.target.value)}
                style={inputStyle}
              >
                <option value="">No character / created character</option>
                {characterOptions.map((option) => (
                  <option key={option.character} value={option.character}>{option.character}</option>
                ))}
              </select>
            </label>
            <div style={fieldPairStyle}>
              <label style={fieldStyle}>
                Playing hand
                <select
                  required
                  aria-label="Player 1 playing hand"
                  value={player1Handedness}
                  onChange={(event) => setPlayer1Handedness(event.target.value)}
                  style={inputStyle}
                >
                  <option value="">Choose hand</option>
                  <option value="right">Right-handed</option>
                  <option value="left">Left-handed</option>
                </select>
              </label>
              <label style={fieldStyle}>
                Backhand grip
                <select
                  required
                  aria-label="Player 1 backhand grip"
                  value={player1BackhandType}
                  onChange={(event) => setPlayer1BackhandType(event.target.value)}
                  style={inputStyle}
                >
                  <option value="">Choose grip</option>
                  <option value="one-handed">One-handed</option>
                  <option value="two-handed">Two-handed</option>
                </select>
              </label>
            </div>
          </fieldset>
          <fieldset style={playerStyleGroup}>
            <legend>Player 2 style</legend>
            <label style={fieldStyle}>
              TE4 character
              <select
                aria-label="Player 2 character"
                value={player2Character}
                disabled={characterRosterStatus === 'loading'}
                onChange={(event) => updatePlayerCharacter(2, event.target.value)}
                style={inputStyle}
              >
                <option value="">No character / created character</option>
                {characterOptions.map((option) => (
                  <option key={option.character} value={option.character}>{option.character}</option>
                ))}
              </select>
            </label>
            <div style={fieldPairStyle}>
              <label style={fieldStyle}>
                Playing hand
                <select
                  required
                  aria-label="Player 2 playing hand"
                  value={player2Handedness}
                  onChange={(event) => setPlayer2Handedness(event.target.value)}
                  style={inputStyle}
                >
                  <option value="">Choose hand</option>
                  <option value="right">Right-handed</option>
                  <option value="left">Left-handed</option>
                </select>
              </label>
              <label style={fieldStyle}>
                Backhand grip
                <select
                  required
                  aria-label="Player 2 backhand grip"
                  value={player2BackhandType}
                  onChange={(event) => setPlayer2BackhandType(event.target.value)}
                  style={inputStyle}
                >
                  <option value="">Choose grip</option>
                  <option value="one-handed">One-handed</option>
                  <option value="two-handed">Two-handed</option>
                </select>
              </label>
            </div>
          </fieldset>
        </div>
        <p className="notice" role="status" style={{ margin: 0, fontSize: 12 }}>
          {characterRosterStatus === 'loading'
            ? 'Loading the character list…'
            : characterRosterStatus === 'error'
              ? <>The character list is unavailable. You can still submit created characters using the required manual style fields.{' '}
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCharacterRosterRetry((value) => value + 1)}>
                  Retry
                </button>
              </>
              : 'Character selections fill in both style fields. You can adjust them if needed; created characters require manual choices.'}
        </p>
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
              disabled={busy}
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
            I confirm this is an official WTSL match and both players agree to show its linked TE4 Coach match publicly.
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
        <p className="notice" style={{ margin: 0, fontSize: 12 }}>
          To enable Coach sharing, attach a .dmo file, check the first consent, and add a TE4 Coach
          match link. Both sharing consents are optional; you can submit the recording privately
          without either.
        </p>
        <button className="btn btn-sm" type="submit" disabled={busy}>
          {busy
            ? uploading
              ? `Uploading recording… ${Math.round(uploadProgress)}%`
              : 'Saving submission…'
            : 'Submit recording'}
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

const playerStyleGroup: CSSProperties = {
  display: 'grid',
  gap: 9,
  minWidth: 0,
  margin: 0,
  padding: 12,
  border: '1px solid var(--line-2)',
  borderRadius: 8,
};

const fieldStyle: CSSProperties = { display: 'grid', gap: 5 };
const fieldPairStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 8,
};
