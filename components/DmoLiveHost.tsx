'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, FolderOpen, Radio, Square } from 'lucide-react';
import { Te4DmoLiveParser, type Te4LiveBestOf, type Te4LiveSnapshot } from '@/lib/te4DmoLive';
import { hasPlayerPositionData } from '@/lib/te4LiveSetup';
import styles from './DmoLiveHost.module.css';

type LocalFileHandle = {
  kind: 'file';
  getFile(): Promise<File>;
};

type LocalDirectoryHandle = {
  name: string;
  values(): AsyncIterableIterator<LocalFileHandle>;
  getDirectoryHandle?(name: string): Promise<LocalDirectoryHandle>;
};

type FolderPickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'read' }) => Promise<LocalDirectoryHandle>;
};

type Props = { displayName: string };
type CheckTone = 'ready' | 'waiting' | 'action';

function SetupCheck({ title, tone, children }: { title: string; tone: CheckTone; children: ReactNode }) {
  const label = tone === 'ready' ? 'Ready' : tone === 'action' ? 'Check' : 'Waiting';
  return (
    <li className={styles.setupCheck} data-state={tone}>
      <div className={styles.setupCheckHeading}>
        <strong>{title}</strong>
        <span>{label}</span>
      </div>
      <p>{children}</p>
    </li>
  );
}

async function newestDmoIn(directory: LocalDirectoryHandle): Promise<{ name: string; file: File } | null> {
  let newest: { name: string; file: File } | null = null;
  for await (const handle of directory.values()) {
    if (handle.kind !== 'file') continue;
    const file = await handle.getFile();
    if (!file.name.toLowerCase().endsWith('.dmo') || !file.size) continue;
    if (
      !newest
      || file.lastModified > newest.file.lastModified
      || (file.lastModified === newest.file.lastModified && file.size > newest.file.size)
    ) newest = { name: file.name, file };
  }
  return newest;
}

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return typeof body?.error === 'string' ? body.error : `Request failed (${response.status}).`;
}

export default function DmoLiveHost({ displayName }: Props) {
  const [directory, setDirectory] = useState<LocalDirectoryHandle | null>(null);
  const [folderLabel, setFolderLabel] = useState('');
  const [folderKind, setFolderKind] = useState<'profiles' | 'demos' | 'other' | null>(null);
  const [browserSupported, setBrowserSupported] = useState<boolean | null>(null);
  const [fileFound, setFileFound] = useState(false);
  const [dmoRecognized, setDmoRecognized] = useState<boolean | null>(null);
  const [realTimeObserved, setRealTimeObserved] = useState(false);
  const [positionsPresent, setPositionsPresent] = useState<boolean | null>(null);
  const [bestOf, setBestOf] = useState<Te4LiveBestOf>(3);
  const [broadcastId, setBroadcastId] = useState<string | null>(null);
  const [discordMessageUrl, setDiscordMessageUrl] = useState('');
  const [playerOne, setPlayerOne] = useState('');
  const [playerTwo, setPlayerTwo] = useState('');
  const [notice, setNotice] = useState('Choose the folder where TE4 is writing its DMO recording.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const parser = useRef<Te4DmoLiveParser | null>(null);
  const activeFilename = useRef('');
  const readBytes = useRef(0);
  const lastSentVersion = useRef(-1);
  const lastHeartbeat = useRef(0);
  const sequence = useRef(0);
  const polling = useRef(false);
  const liveDmoGrowthDetected = useRef(false);

  useEffect(() => {
    setBrowserSupported(Boolean((window as FolderPickerWindow).showDirectoryPicker));
  }, []);

  const chooseFolder = async () => {
    setError('');
    const picker = (window as FolderPickerWindow).showDirectoryPicker;
    if (!picker) {
      setError('Live folder reading needs a recent Chrome or Edge browser. Finished DMO files can still be analyzed in the private replay workspace.');
      return;
    }
    try {
      const selected = await picker.call(window, { mode: 'read' });
      let demosFolder = selected;
      let selectedKind: 'profiles' | 'demos' | 'other' = 'other';
      let selectedLabel = selected.name;
      if (selected.name.toLowerCase() === 'demos') {
        selectedKind = 'demos';
      } else if (selected.getDirectoryHandle) {
        try {
          demosFolder = await selected.getDirectoryHandle('Demos');
          selectedKind = 'profiles';
          selectedLabel = `${selected.name}\\Demos`;
        } catch {
          // A directly selected custom DMO folder is also valid.
        }
      }
      setDirectory(demosFolder);
      setFolderLabel(selectedLabel);
      setFolderKind(selectedKind);
      setFileFound(false);
      setDmoRecognized(null);
      setRealTimeObserved(false);
      setPositionsPresent(null);
      liveDmoGrowthDetected.current = false;
      parser.current = null;
      activeFilename.current = '';
      readBytes.current = 0;
      setNotice(`Checking ${selectedLabel} locally.`);
      try {
        const newest = await newestDmoIn(demosFolder);
        if (!newest) {
          setNotice(`Folder selected: ${selectedLabel}. No .dmo file was found yet.`);
          return;
        }
        setFileFound(true);
        const checkParser = new Te4DmoLiveParser();
        checkParser.append(new Uint8Array(await newest.file.slice(0, 1 << 20).arrayBuffer()));
        if (checkParser.header?.bad) {
          setDmoRecognized(false);
          setNotice('A .dmo file was found, but it does not have a recognized TE4 header.');
          return;
        }
        const snapshot = checkParser.snapshot(newest.name, bestOf);
        if (snapshot) {
          setDmoRecognized(true);
          setPositionsPresent(hasPlayerPositionData(snapshot.court));
          setNotice('Local preflight found a readable TE4 recording. Start a match to check real-time updates.');
        } else {
          setNotice('A .dmo file was found. Start a match to check for readable frames and real-time updates.');
        }
      } catch {
        setNotice(`Folder selected: ${selectedLabel}. The local DMO preflight could not read the folder; try choosing it again.`);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'The TE4 recording folder could not be opened.');
    }
  };

  const startBroadcast = async () => {
    if ((!directory && !discordMessageUrl.trim()) || busy || broadcastId) return;
    if (Boolean(playerOne.trim()) !== Boolean(playerTwo.trim())) {
      setError('Enter both player names or leave both blank.');
      return;
    }
    setBusy(true);
    setError('');
    liveDmoGrowthDetected.current = false;
    setRealTimeObserved(false);
    setPositionsPresent(null);
    try {
      const players = playerOne.trim() && playerTwo.trim()
        ? [playerOne.trim(), playerTwo.trim()]
        : undefined;
      const response = await fetch('/api/live-dmo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hasDmo: Boolean(directory),
          discordMessageUrl: discordMessageUrl.trim(),
          players,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json() as { id?: string };
      if (!body.id) throw new Error('The broadcast could not be started.');
      sequence.current = 0;
      lastSentVersion.current = -1;
      lastHeartbeat.current = 0;
      setBroadcastId(body.id);
      setNotice(directory
        ? 'Broadcast started. Waiting for TE4 to write readable match frames.'
        : 'Broadcast started. The Discord stream will appear in the viewer list below.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The broadcast could not be started.');
    } finally {
      setBusy(false);
    }
  };

  const stopBroadcast = async () => {
    if (!broadcastId || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/live-dmo/${broadcastId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice('Broadcast ended. Its final card remains visible to signed-in viewers for 15 minutes.');
      setBroadcastId(null);
      setDirectory(null);
      setFolderLabel('');
      setFolderKind(null);
      setFileFound(false);
      setDmoRecognized(null);
      setRealTimeObserved(false);
      setPositionsPresent(null);
      liveDmoGrowthDetected.current = false;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The broadcast could not be stopped.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!broadcastId) return;
    let cancelled = false;

    const sendUpdate = async (current?: Te4LiveSnapshot) => {
      const nextSequence = sequence.current + 1;
      const response = await fetch(`/api/live-dmo/${broadcastId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequence: nextSequence,
          ...(current ? { snapshot: current } : {}),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      sequence.current = nextSequence;
      if (current && parser.current) lastSentVersion.current = parser.current.version;
      lastHeartbeat.current = Date.now();
      setError('');
      if (current) setNotice(`Sharing ${current.filename} with signed-in viewers.`);
      else if (!directory) setNotice('Stream broadcast is live for signed-in viewers.');
    };

    const pollFolder = async () => {
      if (polling.current || cancelled) return;
      polling.current = true;
      try {
        if (!directory) {
          if (Date.now() - lastHeartbeat.current >= 10_000) await sendUpdate();
          return;
        }
        const newest = await newestDmoIn(directory);
        if (cancelled) return;
        if (!newest) {
          setFileFound(false);
          setDmoRecognized(null);
          setPositionsPresent(null);
          setNotice('Broadcast active. Waiting for a .dmo file in the selected folder.');
          if (Date.now() - lastHeartbeat.current >= 10_000) await sendUpdate();
          return;
        }

        if (
          !parser.current
          || activeFilename.current !== newest.name
          || newest.file.size < readBytes.current
        ) {
          parser.current = new Te4DmoLiveParser();
          activeFilename.current = newest.name;
          readBytes.current = 0;
          lastSentVersion.current = -1;
          liveDmoGrowthDetected.current = false;
          setRealTimeObserved(false);
          setPositionsPresent(null);
          setNotice(`Reading ${newest.name}.`);
        }

        setFileFound(true);
        if (newest.file.size > readBytes.current) {
          const hadReadThisFile = activeFilename.current === newest.name && readBytes.current > 0;
          const chunk = new Uint8Array(await newest.file.slice(readBytes.current).arrayBuffer());
          parser.current!.append(chunk);
          readBytes.current = newest.file.size;
          if (hadReadThisFile) {
            liveDmoGrowthDetected.current = true;
            setRealTimeObserved(true);
          }
        }

        const current = parser.current!.snapshot(newest.name, bestOf);
        if (!current) {
          if (parser.current!.header?.bad) {
            setDmoRecognized(false);
            setPositionsPresent(null);
            setError('The newest .dmo file does not have a recognized TE4 recording header.');
          } else {
            setNotice(`Reading ${newest.name}. Waiting for enough match frames to publish a scoreboard.`);
          }
          if (Date.now() - lastHeartbeat.current >= 10_000) await sendUpdate();
          return;
        }
        setDmoRecognized(true);
        setPositionsPresent(hasPlayerPositionData(current.court));
        if (!liveDmoGrowthDetected.current) {
          setNotice('Waiting for the selected .dmo to grow during play. Scoreboard snapshots are not shared until a live update is detected.');
          if (Date.now() - lastHeartbeat.current >= 10_000) await sendUpdate();
          return;
        }
        const hasNewSnapshot = parser.current!.version !== lastSentVersion.current;
        const shouldSend = hasNewSnapshot || Date.now() - lastHeartbeat.current >= 10_000;
        if (!shouldSend) return;
        await sendUpdate(hasNewSnapshot ? current : undefined);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'The live recording could not be read.');
      } finally {
        polling.current = false;
      }
    };

    void pollFolder();
    const interval = window.setInterval(() => { void pollFolder(); }, 1200);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      polling.current = false;
    };
  }, [directory, broadcastId, bestOf]);

  const folderTone: CheckTone = !directory
    ? 'waiting'
    : dmoRecognized === false || (folderKind === 'other' && !fileFound)
      ? 'action'
      : fileFound
        ? 'ready'
        : 'waiting';

  return (
    <section className={styles.page}>
      <header className={styles.heading}>
        <div>
        <p className={styles.kicker}>WTSL FORUM / LIVE</p>
          <h1>Live <em>broadcast</em></h1>
          <p>Share a live court reconstructed from a local TE4 recording, a stream link from your Discord post, or both. DMO files stay on your device.</p>
        </div>
        <Link className={styles.watchLink} href="/livestreams"><ExternalLink size={15} /> Viewer page</Link>
      </header>

      <section className={styles.controlPanel} aria-label="Broadcast controls">
          <div className={styles.adminInfo}>
          <span className={styles.icon}><Radio size={19} /></span>
          <div><strong>Broadcaster: {displayName}</strong><small>Any signed-in Forum member can start a broadcast. Only you or a Forum admin can stop yours.</small></div>
        </div>
        <label className={styles.bestOf}>
          <span>Match format</span>
          <select value={bestOf} onChange={(event) => setBestOf(Number(event.currentTarget.value) as Te4LiveBestOf)} disabled={Boolean(broadcastId)}>
            <option value={3}>Best of 3 sets</option>
            <option value={5}>Best of 5 sets</option>
          </select>
        </label>
        <button type="button" className={styles.secondaryButton} onClick={chooseFolder} disabled={busy || Boolean(broadcastId)}>
          <FolderOpen size={16} /> {directory ? 'Change folder' : 'Choose TE4 folder'}
        </button>
        <label className={styles.bestOf}>
          <span>Discord stream message (optional)</span>
          <input
            type="url"
            value={discordMessageUrl}
            onChange={(event) => setDiscordMessageUrl(event.currentTarget.value)}
            placeholder="https://discord.com/channels/…"
            disabled={busy || Boolean(broadcastId)}
            aria-label="Link to your stream message in the WTSL Discord channel"
          />
        </label>
        <label className={styles.bestOf}>
          <span>Match players (optional)</span>
          <input
            type="text"
            value={playerOne}
            onChange={(event) => setPlayerOne(event.currentTarget.value)}
            placeholder="First player"
            maxLength={80}
            disabled={busy || Boolean(broadcastId)}
            aria-label="First player"
          />
          <input
            type="text"
            value={playerTwo}
            onChange={(event) => setPlayerTwo(event.currentTarget.value)}
            placeholder="Second player"
            maxLength={80}
            disabled={busy || Boolean(broadcastId)}
            aria-label="Second player"
          />
        </label>
        {!broadcastId ? (
          <button type="button" className={styles.primaryButton} onClick={startBroadcast} disabled={(!directory && !discordMessageUrl.trim()) || busy}>
            <Radio size={16} /> {busy ? 'Starting…' : 'Start broadcast'}
          </button>
        ) : (
          <button type="button" className={styles.stopButton} onClick={stopBroadcast} disabled={busy}>
            <Square size={15} /> {busy ? 'Stopping…' : 'Stop broadcast'}
          </button>
        )}
      </section>

      <div className={styles.audienceNote}>
        <span className={styles.accessTag}>SIGNED-IN VIEWERS</span>
        <span>Anyone signed in to the Forum can watch below. A broadcast expires automatically if its browser stops sending updates.</span>
      </div>

      <section className={styles.setupChecks} aria-label="TE4 broadcast setup checks">
        <div className={styles.setupIntro}>
          <div>
            <p className={styles.setupKicker}>LOCAL PREFLIGHT</p>
            <h2>TE4 setup checks</h2>
          </div>
          <p>The checks read the selected DMO in this browser. The recording and profile .ini are not uploaded; only derived live snapshots are shared.</p>
        </div>
        <ul className={styles.setupList}>
          <SetupCheck
            title="Browser support"
            tone={browserSupported === false ? 'action' : directory ? 'ready' : 'waiting'}
          >
            {browserSupported === false
              ? 'Use a recent Chrome or Edge browser on the PC running TE4. Folder access is not available in this browser.'
              : browserSupported === true
                ? 'This browser can read a folder you select. The DMO itself stays in this browser.'
                : 'Checking whether this browser supports local folder access.'}
          </SetupCheck>
          <SetupCheck title="Folder and DMO" tone={folderTone}>
            {!directory
              ? 'Choose the TE4 Profiles folder or its Demos subfolder. A custom folder containing .dmo files also works.'
              : dmoRecognized === false
                ? 'A .dmo file was found, but its header is not recognized. Choose the TE4 Demos folder and check the game is writing a match replay.'
                : dmoRecognized === true
                  ? `A readable TE4 recording was found in ${folderLabel}.`
                  : fileFound
                    ? `A .dmo file was found in ${folderLabel}; waiting for enough match frames to confirm it.`
                    : folderKind === 'other'
                      ? `${folderLabel} has no readable .dmo file yet. Choose Profiles or Demos, or a custom folder that contains .dmo files.`
                      : `Reading ${folderLabel}; no .dmo file has been found yet.`}
          </SetupCheck>
          <SetupCheck
            title="Real-time recording"
            tone={realTimeObserved ? 'ready' : fileFound ? 'waiting' : directory ? 'action' : 'waiting'}
          >
            {realTimeObserved
              ? 'The selected .dmo grew during this broadcast, so live recording is being detected.'
              : fileFound
                ? 'A DMO was found. Start a match and this check will confirm when its file grows. If it stays unchanged during play, set TE4 Options → Recordings to Real time.'
                : directory
                  ? 'No .dmo file found yet. In TE4 Options → Recordings, choose Real time, then start a match.'
                  : 'After you select a folder, this check looks for a DMO that updates while a match is being played.'}
          </SetupCheck>
          <SetupCheck
            title="Court-position data"
            tone={positionsPresent === true ? 'ready' : positionsPresent === false ? 'action' : 'waiting'}
          >
            {positionsPresent === true
              ? 'Player positions were found in the local DMO; the Forum can reconstruct the live court.'
              : positionsPresent === false
                ? 'No player positions were detected. Close TE4 and set RecordDebugInfo = 1 under [Record] in your profile .ini, then start a new recording.'
                : 'Waiting for enough readable match frames to check for player positions. If the court stays empty, verify RecordDebugInfo = 1 under [Record] in your profile .ini.'}
          </SetupCheck>
        </ul>
      </section>

      {notice && <p className={styles.statusLine} role="status">{notice}</p>}
      {error && <p className={styles.errorLine} role="alert"><AlertTriangle size={16} />{error}</p>}
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon}><Radio size={22} /></span>
        <h2>{broadcastId ? 'Broadcast running' : 'Ready to go live'}</h2>
        <p>{broadcastId
          ? 'Your broadcast appears in the viewer list below. Other signed-in members can watch it there too.'
          : 'Choose a TE4 folder, add a stream message link, or use both. Your live broadcast appears in the viewer list below.'}</p>
      </div>
    </section>
  );
}
