'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ExternalLink, FolderOpen, Radio, Square } from 'lucide-react';
import {
  hasCompletedDmoPoints,
  LIVE_DMO_UPDATE_INTERVAL_MS,
  replayFrameAtElapsedTime,
  replayCourtWindowFrames,
  Te4DmoLiveParser,
  type Te4DmoReplaySpeed,
  type Te4LiveBestOf,
  type Te4LiveSnapshot,
} from '@/lib/te4DmoLive';
import { findMatchingWtslLiveMatch } from '@/lib/liveBroadcast';
import { consumePendingDmoReaderReset } from '@/lib/dmoReaderState';
import { hasPlayerPositionData } from '@/lib/te4LiveSetup';
import {
  loadDmoDirectory,
  saveDmoDirectory,
  type LocalDmoDirectoryHandle,
} from '@/lib/dmoDirectoryPersistence';
import styles from './DmoLiveHost.module.css';

type FolderPickerWindow = Window & {
  showDirectoryPicker?: (options: { mode: 'read' }) => Promise<LocalDmoDirectoryHandle>;
};

type Props = { displayName: string };
type LiveWtslMatch = {
  name: string;
  bestOf: Te4LiveBestOf;
  rankedPlayers?: [string | null, string | null];
};
type DmoFileOption = { name: string; size: number; lastModified: number };
type DmoReplay = {
  filename: string;
  totalFrames: number;
  bestOf: Te4LiveBestOf;
  speed: Te4DmoReplaySpeed;
  startedAt: number;
  lastFrame: number;
};

const MAX_REPLAY_FILE_BYTES = 64 * 1024 * 1024;
const DMO_READ_CHUNK_BYTES = 1 << 20;

async function newestDmoIn(directory: LocalDmoDirectoryHandle): Promise<{ name: string; file: File } | null> {
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

async function dmoFilesIn(directory: LocalDmoDirectoryHandle): Promise<DmoFileOption[]> {
  const files: DmoFileOption[] = [];
  for await (const handle of directory.values()) {
    if (handle.kind !== 'file') continue;
    const file = await handle.getFile();
    if (!file.name.toLowerCase().endsWith('.dmo') || !file.size) continue;
    files.push({ name: file.name, size: file.size, lastModified: file.lastModified });
  }
  return files.sort((first, second) =>
    second.lastModified - first.lastModified
    || second.size - first.size
    || first.name.localeCompare(second.name));
}

async function dmoNamedIn(
  directory: LocalDmoDirectoryHandle,
  name: string,
): Promise<{ name: string; file: File } | null> {
  for await (const handle of directory.values()) {
    if (handle.kind !== 'file') continue;
    const file = await handle.getFile();
    if (file.name === name && file.name.toLowerCase().endsWith('.dmo') && file.size) {
      return { name: file.name, file };
    }
  }
  return null;
}

async function parseCompleteDmo(file: File, bestOf: Te4LiveBestOf) {
  if (file.size > MAX_REPLAY_FILE_BYTES) {
    throw new Error('This DMO is larger than the 64 MiB replay limit.');
  }
  const parser = new Te4DmoLiveParser();
  for (let offset = 0; offset < file.size; offset += DMO_READ_CHUNK_BYTES) {
    const chunk = new Uint8Array(await file.slice(offset, offset + DMO_READ_CHUNK_BYTES).arrayBuffer());
    parser.append(chunk);
  }
  if (parser.header?.bad) throw new Error('This file does not have a recognized TE4 DMO header.');
  const snapshot = parser.snapshot(file.name, bestOf);
  if (!snapshot) throw new Error('This DMO does not contain enough readable TE4 match frames to replay.');
  if (!hasCompletedDmoPoints(snapshot)) {
    throw new Error('Failed to parse this DMO. Please select an online match.');
  }
  return { parser, snapshot };
}

async function responseError(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return typeof body?.error === 'string' ? body.error : `Request failed (${response.status}).`;
}

export default function DmoLiveHost({ displayName }: Props) {
  const [directory, setDirectory] = useState<LocalDmoDirectoryHandle | null>(null);
  const [savedDirectory, setSavedDirectory] = useState<LocalDmoDirectoryHandle | null>(null);
  const [folderLabel, setFolderLabel] = useState('');
  const [folderKind, setFolderKind] = useState<'profiles' | 'demos' | 'other' | null>(null);
  const [browserSupported, setBrowserSupported] = useState<boolean | null>(null);
  const [autoWatching, setAutoWatching] = useState(false);
  const [liveMatches, setLiveMatches] = useState<LiveWtslMatch[]>([]);
  const [dmoFiles, setDmoFiles] = useState<DmoFileOption[]>([]);
  const [selectedDmoName, setSelectedDmoName] = useState('');
  const [replaySpeed, setReplaySpeed] = useState<Te4DmoReplaySpeed>(1);
  const [liveFeedReady, setLiveFeedReady] = useState(false);
  const [fileFound, setFileFound] = useState(false);
  const [dmoRecognized, setDmoRecognized] = useState<boolean | null>(null);
  const [realTimeObserved, setRealTimeObserved] = useState(false);
  const [positionsPresent, setPositionsPresent] = useState<boolean | null>(null);
  const [bestOf, setBestOf] = useState<Te4LiveBestOf>(3);
  const [broadcastId, setBroadcastId] = useState<string | null>(null);
  const [broadcastMode, setBroadcastMode] = useState<'manual' | 'auto' | null>(null);
  const [officialByBroadcaster, setOfficialByBroadcaster] = useState(false);
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
  const resetDmoReaderOnNextPoll = useRef(false);
  const liveMatchesRef = useRef<LiveWtslMatch[]>([]);
  const liveFeedReadyRef = useRef(false);
  const autoWatchingRef = useRef(false);
  const broadcastModeRef = useRef<'manual' | 'auto' | null>(null);
  const automaticPlayers = useRef<[string, string] | null>(null);
  const replay = useRef<DmoReplay | null>(null);
  const canonicalBroadcastPlayers = useRef<[string, string] | null>(null);
  const lastAutomaticAttemptAt = useRef(0);

  useEffect(() => {
    setBrowserSupported(Boolean((window as FolderPickerWindow).showDirectoryPicker));
  }, []);

  useEffect(() => {
    let active = true;
    void loadDmoDirectory().then(async (saved) => {
      if (!active || !saved) return;
      setSavedDirectory(saved);
      setFolderLabel(saved.name);
      const permission = await saved.queryPermission?.({ mode: 'read' }).catch(() => 'prompt');
      if (!active) return;
      if (permission === 'granted') {
        setDirectory(saved);
        setFolderKind(saved.name.toLowerCase() === 'demos' ? 'demos' : 'other');
        setAutoWatching(true);
        autoWatchingRef.current = true;
        setNotice(`Saved folder access restored for ${saved.name}. Automatic WTSL detection is on.`);
      } else {
        setNotice(`Saved folder ${saved.name} is ready. Reconnect its access to resume automatic WTSL detection.`);
      }
    }).catch(() => {
      if (active) setNotice('The saved DMO folder could not be restored. Choose it again to enable automatic detection.');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    autoWatchingRef.current = autoWatching;
  }, [autoWatching]);

  useEffect(() => {
    if (!directory) {
      setDmoFiles([]);
      setSelectedDmoName('');
      return;
    }
    let cancelled = false;
    let requestInFlight = false;
    const refreshDmoFiles = async () => {
      if (requestInFlight || cancelled) return;
      requestInFlight = true;
      try {
        const files = await dmoFilesIn(directory);
        if (cancelled) return;
        setDmoFiles(files);
        setSelectedDmoName((current) =>
          current && files.some((file) => file.name === current)
            ? current
            : files[0]?.name ?? '');
      } catch {
        if (!cancelled) setDmoFiles([]);
      } finally {
        requestInFlight = false;
      }
    };
    void refreshDmoFiles();
    const interval = window.setInterval(() => { void refreshDmoFiles(); }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [directory]);

  useEffect(() => {
    if (!directory || !autoWatching) {
      liveFeedReadyRef.current = false;
      setLiveFeedReady(false);
      return;
    }
    let cancelled = false;
    let requestInFlight = false;
    const refreshMatches = async () => {
      if (requestInFlight || cancelled) return;
      requestInFlight = true;
      try {
        const response = await fetch('/api/live-scores', { cache: 'no-store' });
        if (!response.ok) throw new Error('The WTSL live-match feed could not be refreshed.');
        const body = await response.json() as { matches?: LiveWtslMatch[] };
        const matches = Array.isArray(body.matches) ? body.matches : [];
        if (cancelled) return;
        liveMatchesRef.current = matches;
        liveFeedReadyRef.current = true;
        lastAutomaticAttemptAt.current = 0;
        setLiveMatches(matches);
        setLiveFeedReady(true);
      } catch {
        if (!cancelled) {
          liveFeedReadyRef.current = false;
          setLiveFeedReady(false);
        }
      } finally {
        requestInFlight = false;
      }
    };
    void refreshMatches();
    const interval = window.setInterval(() => { void refreshMatches(); }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [directory, autoWatching]);

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
      setSavedDirectory(demosFolder);
      setFolderLabel(selectedLabel);
      setFolderKind(selectedKind);
      setSelectedDmoName('');
      setAutoWatching(true);
      autoWatchingRef.current = true;
      setFileFound(false);
      setDmoRecognized(null);
      setRealTimeObserved(false);
      setPositionsPresent(null);
      liveDmoGrowthDetected.current = false;
      parser.current = null;
      activeFilename.current = '';
      readBytes.current = 0;
      setNotice(`Checking ${selectedLabel} locally. Automatic WTSL detection is on while this page stays open.`);
      try {
        await saveDmoDirectory(demosFolder);
      } catch {
        setError('The folder is available now, but this browser could not save its access for next time.');
      }
      try {
        const newest = await newestDmoIn(demosFolder);
        if (!newest) {
          setNotice(`Folder selected: ${selectedLabel}. No .dmo file was found yet.`);
          return;
        }
        setSelectedDmoName(newest.name);
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
          setNotice('Local preflight found a readable TE4 recording. Choose a DMO below to replay a completed match, or keep automatic detection on for live WTSL matches.');
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

  const reconnectSavedFolder = async () => {
    if (!savedDirectory) return;
    setError('');
    try {
      const permission = await savedDirectory.requestPermission?.({ mode: 'read' });
      if (permission !== 'granted') {
        setError('Folder access was not granted. Choose the TE4 folder again to reconnect it.');
        return;
      }
      setDirectory(savedDirectory);
      setFolderKind(savedDirectory.name.toLowerCase() === 'demos' ? 'demos' : 'other');
      setAutoWatching(true);
      autoWatchingRef.current = true;
      setNotice(`Folder access restored for ${savedDirectory.name}. Automatic WTSL detection is on.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saved folder access could not be restored.');
    }
  };

  const startBroadcast = async (
    mode: 'manual' | 'auto' = 'manual',
    automaticMatch?: { players: [string, string]; bestOf: Te4LiveBestOf },
  ) => {
    if ((!directory && !discordMessageUrl.trim()) || busy || broadcastId) return;
    if (mode === 'auto' && (!directory || !liveFeedReadyRef.current)) return;
    if (mode === 'manual' && !directory && Boolean(playerOne.trim()) !== Boolean(playerTwo.trim())) {
      setError('Enter both player names or leave both blank.');
      return;
    }
    const broadcastBestOf = automaticMatch?.bestOf ?? bestOf;
    setBusy(true);
    setError('');
    if (mode === 'manual') {
      liveDmoGrowthDetected.current = false;
      setRealTimeObserved(false);
    }
    setPositionsPresent(null);
    let createdBroadcastId: string | null = null;
    let replaySource: {
      name: string;
      file: File;
      parser: Te4DmoLiveParser;
      snapshot: Te4LiveSnapshot;
    } | null = null;
    try {
      if (mode === 'manual' && directory) {
        if (!selectedDmoName) throw new Error('Choose a DMO file to replay first.');
        const selected = await dmoNamedIn(directory, selectedDmoName);
        if (!selected) throw new Error('The selected DMO is no longer in the connected folder. Choose another file.');
        const parsed = await parseCompleteDmo(selected.file, broadcastBestOf);
        replaySource = { ...selected, ...parsed };
        setFileFound(true);
        setDmoRecognized(true);
        setPositionsPresent(hasPlayerPositionData(parsed.snapshot.court));
      }

      const typedPlayers = !directory && playerOne.trim() && playerTwo.trim()
        ? [playerOne.trim(), playerTwo.trim()] as [string, string]
        : undefined;
      const players = automaticMatch?.players ?? replaySource?.snapshot.players ?? typedPlayers;
      if (mode === 'manual' && officialByBroadcaster && broadcastBestOf === 1) {
        setOfficialByBroadcaster(false);
      } else if (mode === 'manual' && officialByBroadcaster && (!players || (broadcastBestOf !== 3 && broadcastBestOf !== 5))) {
        throw new Error('To tag this as official, a DMO replay needs player names and the match format must be best of 3 or best of 5.');
      }

      const response = await fetch('/api/live-dmo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hasDmo: Boolean(directory),
          replay: Boolean(replaySource),
          replaySpeed: replaySource ? replaySpeed : 1,
          discordMessageUrl: mode === 'manual' ? discordMessageUrl.trim() : '',
          players,
          mode,
          bestOf: broadcastBestOf,
          officialByBroadcaster: officialByBroadcaster && broadcastBestOf !== 1,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json() as {
        id?: string;
        players?: [string, string];
      };
      if (!body.id) throw new Error('The broadcast could not be started.');
      createdBroadcastId = body.id;
      const canonicalPlayers = body.players ?? players ?? null;
      canonicalBroadcastPlayers.current = canonicalPlayers;
      replay.current = null;
      resetDmoReaderOnNextPoll.current = false;
      sequence.current = 0;
      lastSentVersion.current = -1;
      lastHeartbeat.current = 0;

      if (replaySource) {
        parser.current = replaySource.parser;
        activeFilename.current = replaySource.name;
        readBytes.current = replaySource.file.size;
        const firstFrame = replaySource.parser.snapshot(
          replaySource.name,
          broadcastBestOf,
          10,
          replayCourtWindowFrames(replaySpeed),
        );
        if (!firstFrame) throw new Error('The selected DMO could not produce its opening replay snapshot.');
        const initialResponse = await fetch(`/api/live-dmo/${body.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sequence: 1,
            snapshot: { ...firstFrame, players: canonicalPlayers ?? firstFrame.players },
          }),
        });
        if (!initialResponse.ok) throw new Error(await responseError(initialResponse));
        sequence.current = 1;
        lastSentVersion.current = replaySource.parser.version;
        lastHeartbeat.current = Date.now();
        replay.current = {
          filename: replaySource.name,
          totalFrames: replaySource.parser.frameCount,
          bestOf: broadcastBestOf,
          speed: replaySpeed,
          startedAt: Date.now(),
          lastFrame: 10,
        };
      }

      setBroadcastId(body.id);
      setBroadcastMode(mode);
      broadcastModeRef.current = mode;
      automaticPlayers.current = mode === 'auto' ? players ?? null : null;
      setNotice(directory
        ? mode === 'auto'
          ? 'WTSL live match confirmed. Automatic DMO broadcast started.'
          : `Replaying ${replaySource?.name ?? 'the selected DMO'} from the beginning at ${replaySpeed}×.`
        : 'Broadcast started. The Discord stream will appear in the viewer list below.');
    } catch (cause) {
      replay.current = null;
      parser.current = null;
      if (createdBroadcastId) {
        await fetch(`/api/live-dmo/${createdBroadcastId}`, { method: 'DELETE' }).catch(() => undefined);
      }
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
      if (!response.ok && response.status !== 404) throw new Error(await responseError(response));
      setNotice('Broadcast ended. Its final card remains visible to signed-in viewers for 15 minutes.');
      setBroadcastId(null);
      setBroadcastMode(null);
      broadcastModeRef.current = null;
      automaticPlayers.current = null;
      replay.current = null;
      canonicalBroadcastPlayers.current = null;
      if (broadcastMode === 'auto') {
        setAutoWatching(false);
        autoWatchingRef.current = false;
        setNotice('Broadcast ended and automatic WTSL detection is paused. Your saved folder remains connected.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The broadcast could not be stopped.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!broadcastId && (!directory || !autoWatching)) return;
    let cancelled = false;

    const sendUpdate = async (current?: Te4LiveSnapshot) => {
      if (!broadcastId) return;
      const nextSequence = sequence.current + 1;
      const snapshot = current
        ? { ...current, players: canonicalBroadcastPlayers.current ?? current.players }
        : undefined;
      const response = await fetch(`/api/live-dmo/${broadcastId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequence: nextSequence,
          ...(snapshot ? { snapshot } : {}),
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

    const endActiveBroadcast = async (message: string) => {
      if (!broadcastId) return;
      const response = await fetch(`/api/live-dmo/${broadcastId}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw new Error(await responseError(response));
      if (cancelled) return;
      setBroadcastId(null);
      setBroadcastMode(null);
      broadcastModeRef.current = null;
      automaticPlayers.current = null;
      canonicalBroadcastPlayers.current = null;
      replay.current = null;
      setNotice(message);
    };

    const pollFolder = async () => {
      if (polling.current || cancelled) return;
      polling.current = true;
      try {
        consumePendingDmoReaderReset(resetDmoReaderOnNextPoll, {
          parser,
          activeFilename,
          readBytes,
          lastSentVersion,
        });
        if (!directory) {
          if (broadcastId && Date.now() - lastHeartbeat.current >= 10_000) await sendUpdate();
          return;
        }
        if (broadcastId && replay.current) {
          const playback = replay.current;
          const frame = replayFrameAtElapsedTime(
            playback.totalFrames,
            Date.now() - playback.startedAt,
            playback.speed,
          );
          if (frame > playback.lastFrame) {
            const current = parser.current?.snapshot(
              playback.filename,
              playback.bestOf,
              frame,
              replayCourtWindowFrames(playback.speed),
            );
            if (!current) throw new Error('The selected DMO could not produce the next replay snapshot.');
            replay.current = { ...playback, lastFrame: frame };
            await sendUpdate(current);
            if (frame >= playback.totalFrames) {
              await endActiveBroadcast('DMO replay complete. Its final match board remains visible for 15 minutes.');
            }
          } else if (Date.now() - lastHeartbeat.current >= 10_000) {
            await sendUpdate();
          }
          return;
        }
        const newest = await newestDmoIn(directory);
        if (cancelled) return;
        if (!newest) {
          if (broadcastId && broadcastModeRef.current === 'auto') {
            const pair = automaticPlayers.current;
            const activeMatch = pair && liveFeedReadyRef.current
              ? findMatchingWtslLiveMatch(pair, liveMatchesRef.current)
              : null;
            if (!activeMatch || activeMatch.bestOf !== bestOf) {
              await endActiveBroadcast('The WTSL live feed no longer confirms this pair. Automatic broadcast ended; monitoring for the next match.');
              return;
            }
          }
          setFileFound(false);
          setDmoRecognized(null);
          setPositionsPresent(null);
          setNotice(autoWatchingRef.current && !broadcastId
            ? 'Automatic detection is on. Waiting for a .dmo file in the selected folder.'
            : 'Broadcast active. Waiting for a .dmo file in the selected folder.');
          if (broadcastId && Date.now() - lastHeartbeat.current >= 10_000) await sendUpdate();
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
          if (cancelled) return;
          parser.current!.append(chunk);
          readBytes.current = newest.file.size;
          if (hadReadThisFile) {
            liveDmoGrowthDetected.current = true;
            setRealTimeObserved(true);
          }
        }

        let current = parser.current!.snapshot(newest.name, bestOf);
        if (broadcastId && broadcastModeRef.current === 'auto') {
          const pair = current?.players ?? automaticPlayers.current;
          const activeMatch = pair && liveFeedReadyRef.current
            ? findMatchingWtslLiveMatch(pair, liveMatchesRef.current)
            : null;
          if (!activeMatch || activeMatch.bestOf !== bestOf) {
            await endActiveBroadcast(
              liveFeedReadyRef.current
                ? 'The WTSL feed no longer confirms this player pair as live. Automatic broadcast ended; monitoring for the next match.'
                : 'The WTSL live-match feed could not be verified. Automatic broadcast ended; monitoring will resume when the feed returns.',
            );
            return;
          }
          current = parser.current!.snapshot(newest.name, activeMatch.bestOf);
        }
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
          if (broadcastId && Date.now() - lastHeartbeat.current >= 10_000) await sendUpdate();
          return;
        }
        if (!broadcastId) {
          if (!autoWatchingRef.current) return;
          if (!liveFeedReadyRef.current) {
            setNotice('Automatic detection is waiting for a verified WTSL live-match feed.');
            return;
          }
          if (!hasCompletedDmoPoints(current)) {
            setNotice('Waiting for a completed point to be parsed before broadcasting this DMO.');
            return;
          }
          const activeMatch = findMatchingWtslLiveMatch(current.players, liveMatchesRef.current);
          if (!activeMatch) {
            setNotice(`Live DMO detected for ${current.players[0]} vs ${current.players[1]}. Waiting for the same pair in the WTSL live feed.`);
            return;
          }
          if (Date.now() - lastAutomaticAttemptAt.current < 15_000) return;
          const matchedSnapshot = parser.current!.snapshot(newest.name, activeMatch.bestOf);
          if (!matchedSnapshot || !hasCompletedDmoPoints(matchedSnapshot)) return;
          lastAutomaticAttemptAt.current = Date.now();
          setBestOf(activeMatch.bestOf);
          await startBroadcast('auto', { players: matchedSnapshot.players, bestOf: activeMatch.bestOf });
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
    const interval = window.setInterval(() => { void pollFolder(); }, LIVE_DMO_UPDATE_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      // Keep the shared lock until an in-flight poll reaches its `finally`.
    };
  }, [directory, broadcastId, bestOf, autoWatching]);

  const localPreflight = (() => {
    const unresolved: Array<{ tone: 'waiting' | 'action'; message: string }> = [];
    if (browserSupported === null) {
      unresolved.push({ tone: 'waiting', message: 'Checking browser access' });
    } else if (!browserSupported) {
      unresolved.push({ tone: 'action', message: 'Use Chrome or Edge for local DMO access' });
    }
    if (!directory) {
      unresolved.push({
        tone: 'action',
        message: savedDirectory ? 'Reconnect the saved folder' : 'Select a TE4 DMO folder',
      });
    } else if (!fileFound) {
      unresolved.push({
        tone: folderKind === 'other' ? 'action' : 'waiting',
        message: folderKind === 'other' ? 'No DMO found; choose a TE4 recording folder' : 'Waiting for a DMO file',
      });
    } else if (dmoRecognized === null) {
      unresolved.push({ tone: 'waiting', message: 'Checking the selected DMO' });
    } else if (dmoRecognized === false) {
      unresolved.push({ tone: 'action', message: 'No valid TE4 DMO found' });
    } else {
      if (positionsPresent === null) {
        unresolved.push({ tone: 'waiting', message: 'Checking court data' });
      } else if (positionsPresent === false) {
        unresolved.push({ tone: 'action', message: 'Court data missing; enable RecordDebugInfo and record again' });
      }
      if (!realTimeObserved && !replay.current) {
        unresolved.push({ tone: 'waiting', message: 'Select a completed DMO to replay or wait for live file growth' });
      }
    }
    if (!unresolved.length) return { tone: 'ready', message: 'Ready for broadcast — all local checks passed.' };
    return {
      tone: unresolved.some((item) => item.tone === 'action') ? 'action' : 'waiting',
      message: unresolved.map((item) => item.message).join(' · '),
    };
  })();

  return (
    <section className={styles.page}>
      <header className={styles.heading}>
        <div>
        <p className={styles.kicker}>WTSL FORUM / LIVE</p>
          <h1>Live <em>Streams</em></h1>
          <p>Share a live court, replay a completed DMO from the start, or add a stream link from your Discord post. DMO files stay on your device.</p>
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
          <select
            value={bestOf}
            onChange={(event) => {
              const next = Number(event.currentTarget.value) as Te4LiveBestOf;
              setBestOf(next);
              if (next === 1) setOfficialByBroadcaster(false);
            }}
            disabled={Boolean(broadcastId)}
          >
            <option value={1}>Best of 1 set</option>
            <option value={3}>Best of 3 sets</option>
            <option value={5}>Best of 5 sets</option>
          </select>
        </label>
        <button type="button" className={styles.secondaryButton} onClick={chooseFolder} disabled={busy || Boolean(broadcastId)}>
          <FolderOpen size={16} /> {directory ? 'Change folder' : 'Choose TE4 folder'}
        </button>
        {directory && (
          <label className={styles.bestOf}>
            <span>DMO to replay</span>
            <select
              value={selectedDmoName}
              onChange={(event) => setSelectedDmoName(event.currentTarget.value)}
              disabled={busy || Boolean(broadcastId)}
              aria-label="Select a DMO recording to replay"
            >
              {!dmoFiles.length
                ? <option value="">{fileFound ? 'Scanning DMO folder…' : 'No DMO files found'}</option>
                : dmoFiles.map((file) => (
                  <option key={file.name} value={file.name}>
                    {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </option>
                ))}
            </select>
          </label>
        )}
        {directory && (
          <label className={styles.bestOf}>
            <span>Replay speed</span>
            <select
              value={replaySpeed}
              onChange={(event) => setReplaySpeed(Number(event.currentTarget.value) as Te4DmoReplaySpeed)}
              disabled={busy || Boolean(broadcastId)}
              aria-label="DMO replay speed"
            >
              <option value={1}>1× · real time</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </label>
        )}
        {savedDirectory && !directory && (
          <button type="button" className={styles.secondaryButton} onClick={reconnectSavedFolder} disabled={busy || Boolean(broadcastId)}>
            <FolderOpen size={16} /> Reconnect saved folder
          </button>
        )}
        {directory && !broadcastId && (
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => {
              const next = !autoWatching;
              setAutoWatching(next);
              autoWatchingRef.current = next;
              setNotice(next
                ? 'Automatic WTSL detection is on while this page stays open.'
                : 'Automatic WTSL detection is paused. Manual broadcasts remain available.');
            }}
            disabled={busy}
          >
            {autoWatching ? 'Pause automatic detection' : 'Resume automatic detection'}
          </button>
        )}
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
        {!directory && <label className={styles.bestOf}>
          <span>Match players (optional; needed for match tags)</span>
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
        </label>}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 310, color: 'var(--soft, #c4d0e2)', fontSize: 11 }}>
          <input
            type="checkbox"
            checked={officialByBroadcaster}
            onChange={(event) => setOfficialByBroadcaster(event.currentTarget.checked)}
            disabled={busy || Boolean(broadcastId) || bestOf === 1}
          />
          Broadcaster tags this as an official match (best of 3 or 5)
        </label>
        {!broadcastId ? (
          <button type="button" className={styles.primaryButton} onClick={() => void startBroadcast('manual')} disabled={(!directory && !discordMessageUrl.trim()) || busy}>
            <Radio size={16} /> {busy ? 'Starting…' : directory ? 'Replay selected DMO' : 'Start broadcast manually'}
          </button>
        ) : (
          <button type="button" className={styles.stopButton} onClick={stopBroadcast} disabled={busy}>
            <Square size={15} /> {busy ? 'Stopping…' : broadcastMode === 'auto' ? 'Stop and pause auto' : 'Stop broadcast'}
          </button>
        )}
      </section>

      <div className={styles.audienceNote}>
        <span className={styles.accessTag}>SIGNED-IN VIEWERS</span>
          <span>Anyone signed in to the Forum can watch below. Keep this page open while a live match is detected or a selected DMO is replayed; the recording stays on this device and only score/court snapshots are shared.</span>
      </div>
      {directory && (
        <p className={styles.statusLine} role="status">
          {autoWatching
            ? (liveFeedReady
              ? `Automatic detection is on · ${liveMatches.length} WTSL live ${liveMatches.length === 1 ? 'match' : 'matches'} checked`
              : 'Automatic detection is on · waiting for the WTSL live-match feed')
            : 'Automatic detection is paused · manual broadcast controls remain available'}
        </p>
      )}

      <section
        className={styles.preflightStatus}
        data-state={localPreflight.tone}
        aria-label="Local broadcast status"
      >
        <p className={styles.preflightKicker}>LOCAL PREFLIGHT</p>
        <p className={styles.preflightMessage} role="status" aria-live="polite">{localPreflight.message}</p>
      </section>

      {notice && <p className={styles.statusLine} role="status">{notice}</p>}
      {error && <p className={styles.errorLine} role="alert"><AlertTriangle size={16} />{error}</p>}
      <div className={styles.emptyState}>
        <span className={styles.emptyIcon}><Radio size={22} /></span>
        <h2>{broadcastId ? 'Broadcast running' : 'Ready to go live'}</h2>
        <p>{broadcastId
          ? replay.current
            ? 'Your replay appears in the viewer list below. Signed-in members can watch the match progress there.'
            : 'Your broadcast appears in the viewer list below. Other signed-in members can watch it there too.'
          : 'Choose a TE4 folder to replay a completed DMO, add a stream message link, or use both. Multiple broadcasts appear in the viewer list.'}</p>
      </div>
    </section>
  );
}
