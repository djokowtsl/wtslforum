'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, FolderOpen, Radio, Square } from 'lucide-react';
import { Te4DmoLiveParser, type Te4LiveBestOf, type Te4LiveSnapshot } from '@/lib/te4DmoLive';
import DmoLiveDisplay from './DmoLiveDisplay';
import styles from './DmoLiveHost.module.css';

type LocalFileHandle = {
  kind: 'file';
  getFile(): Promise<File>;
};

type LocalDirectoryHandle = {
  name: string;
  values(): AsyncIterableIterator<LocalFileHandle>;
};

type FolderPickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'read' }) => Promise<LocalDirectoryHandle>;
};

type Props = { adminName: string };

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return typeof body?.error === 'string' ? body.error : `Request failed (${response.status}).`;
}

export default function DmoLiveHost({ adminName }: Props) {
  const [directory, setDirectory] = useState<LocalDirectoryHandle | null>(null);
  const [bestOf, setBestOf] = useState<Te4LiveBestOf>(3);
  const [broadcastId, setBroadcastId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Te4LiveSnapshot | null>(null);
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

  const chooseFolder = async () => {
    setError('');
    const picker = (window as FolderPickerWindow).showDirectoryPicker;
    if (!picker) {
      setError('Live folder reading needs a recent Chrome or Edge browser. Finished DMO files can still be analyzed in the private replay workspace.');
      return;
    }
    try {
      const selected = await picker.call(window, { mode: 'read' });
      setDirectory(selected);
      setSnapshot(null);
      parser.current = null;
      activeFilename.current = '';
      readBytes.current = 0;
      setNotice(`Folder selected: ${selected.name}. Start the broadcast when TE4 is recording.`);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'The TE4 recording folder could not be opened.');
    }
  };

  const startBroadcast = async () => {
    if (!directory || busy || broadcastId) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/dmo-live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json() as { id?: string };
      if (!body.id) throw new Error('The broadcast could not be started.');
      sequence.current = 0;
      lastSentVersion.current = -1;
      lastHeartbeat.current = 0;
      setBroadcastId(body.id);
      setNotice('Broadcast started. Waiting for TE4 to write readable match frames.');
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
      const response = await fetch(`/api/admin/dmo-live/${broadcastId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice('Broadcast ended. The final scoreboard remains available to signed-in viewers for 15 minutes.');
      setBroadcastId(null);
      setDirectory(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The broadcast could not be stopped.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!directory || !broadcastId) return;
    let cancelled = false;

    const pollFolder = async () => {
      if (polling.current || cancelled) return;
      polling.current = true;
      try {
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
        if (cancelled) return;
        if (!newest) {
          setNotice('Broadcast active. Waiting for a .dmo file in the selected folder.');
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
          setNotice(`Reading ${newest.name}.`);
        }

        if (newest.file.size > readBytes.current) {
          const chunk = new Uint8Array(await newest.file.slice(readBytes.current).arrayBuffer());
          parser.current!.append(chunk);
          readBytes.current = newest.file.size;
        }

        const current = parser.current!.snapshot(newest.name, bestOf);
        if (!current) {
          if (parser.current!.header?.bad) {
            setError('The newest .dmo file does not have a recognized TE4 recording header.');
          } else {
            setNotice(`Reading ${newest.name}. Waiting for enough match frames to publish a scoreboard.`);
          }
          return;
        }
        setSnapshot(current);
        const shouldSend = parser.current!.version !== lastSentVersion.current
          || Date.now() - lastHeartbeat.current >= 10_000;
        if (!shouldSend) return;

        const nextSequence = sequence.current + 1;
        const response = await fetch(`/api/admin/dmo-live/${broadcastId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sequence: nextSequence, snapshot: current }),
        });
        if (!response.ok) throw new Error(await responseError(response));
        sequence.current = nextSequence;
        lastSentVersion.current = parser.current!.version;
        lastHeartbeat.current = Date.now();
        setError('');
        setNotice(`Sharing ${newest.name} with signed-in viewers.`);
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

  return (
    <main className={styles.page}>
      <header className={styles.heading}>
        <div>
          <p className={styles.kicker}>STAFF TOOLS / TE4</p>
          <h1>Live DMO <em>broadcast</em></h1>
          <p>Start a private, temporary live view from a growing TE4 recording. The .dmo stays on this computer; only the scoreboard and recent court positions are shared.</p>
        </div>
        <Link className={styles.watchLink} href="/live-dmo"><ExternalLink size={15} /> Viewer page</Link>
      </header>

      <section className={styles.controlPanel} aria-label="Broadcast controls">
        <div className={styles.adminInfo}>
          <span className={styles.icon}><Radio size={19} /></span>
          <div><strong>Broadcaster: {adminName}</strong><small>Only Forum admins can start or stop a broadcast.</small></div>
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
        {!broadcastId ? (
          <button type="button" className={styles.primaryButton} onClick={startBroadcast} disabled={!directory || busy}>
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
        <span>Anyone signed in to the Forum can watch at <Link href="/live-dmo">/live-dmo</Link>. A broadcast expires automatically if the admin browser stops sending updates.</span>
      </div>

      {notice && <p className={styles.statusLine} role="status">{notice}</p>}
      {error && <p className={styles.errorLine} role="alert"><AlertTriangle size={16} />{error}</p>}
      {snapshot ? (
        <DmoLiveDisplay snapshot={snapshot} state="live" />
      ) : (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}><Radio size={22} /></span>
          <h2>Waiting for match data</h2>
          <p>Select the folder TE4 uses for DMO recordings, then start the broadcast. The match display appears once the browser can read enough frames.</p>
        </div>
      )}
    </main>
  );
}
