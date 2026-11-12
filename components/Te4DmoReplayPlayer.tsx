'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { embedTe4ViewerHtml } from '@/lib/te4ViewerEmbed';
import { te4ViewerToLiveSnapshot } from '@/lib/te4DmoReplaySnapshot';
import type { Te4LiveSnapshot } from '@/lib/te4DmoLive';
import { alignDmoReplayPlayerStyles, dmoReplayPlayerStyleOrder } from '@/lib/dmoReplayCharacterStyles';
import {
  buildTe4DmoReplayScoreTimeline,
  te4DmoReplayScoreAtFrame,
  te4DmoReplayScoreKey,
  type Te4DmoReplayScore,
} from '@/lib/te4DmoReplayScoreboard';
import type { Te4ViewerData } from '@/lib/te4DmoTypes';
import type { PlayerStrokeStylePair } from '@/lib/liveCourtPerformance';
import { useTe4ViewerTheme } from '@/components/useTe4ViewerTheme';
import DmoLiveCourt3D from './DmoLiveCourt3D';
import DmoReplayScoreBug from './DmoReplayScoreBug';
import type { StadiumScoreboardData } from './DmoStadiumArchitecture';
import styles from './Te4DmoReplayPlayer.module.css';
import { useNativePlayerMotions } from './useNativePlayerMotions';

type Props = {
  broadcastId?: string;
  replayUrl?: string;
  replaySubmissionId?: string;
  characterNames?: readonly [string | null, string | null];
  allowAutomaticFallback?: boolean;
  initialSpeed: 1 | 2 | 4;
  isWta?: boolean;
  tournamentRound?: string | null;
  handedness: ['left' | 'right', 'left' | 'right'];
  strokeStyles?: PlayerStrokeStylePair;
  submissionPlayers?: readonly [string, string];
  fallback?: ReactNode;
};

function isViewerData(value: unknown): value is Te4ViewerData {
  const viewer = value as Te4ViewerData | null;
  return Boolean(
    viewer
    && Array.isArray(viewer.names)
    && viewer.names.length === 2
    && viewer.names.every((name) => typeof name === 'string')
    && typeof viewer.match?.d === 'string'
    && Array.isArray(viewer.pts)
    && ['hard', 'clay', 'grass', 'unknown'].includes(viewer.surface),
  );
}

export default function Te4DmoReplayPlayer({
  broadcastId,
  replayUrl,
  replaySubmissionId,
  characterNames,
  allowAutomaticFallback = false,
  initialSpeed,
  isWta,
  tournamentRound = 'auto',
  handedness,
  strokeStyles,
  submissionPlayers,
  fallback,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [viewer, setViewer] = useState<Te4ViewerData | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<Te4LiveSnapshot | null>(null);
  const [replayPresentation, setReplayPresentation] = useState<{
    handedness: ['left' | 'right', 'left' | 'right'];
    strokeStyles?: PlayerStrokeStylePair;
  } | null>(null);
  const [view, setView] = useState<'court' | 'analysis'>('court');
  const [srcDoc, setSrcDoc] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [classicError, setClassicError] = useState('');
  const [replayScore, setReplayScore] = useState<Te4DmoReplayScore | null>(null);
  const replayScoreKeyRef = useRef('');
  const syncViewerTheme = useTe4ViewerTheme(frameRef);
  const activeHandedness = replayPresentation?.handedness ?? handedness;
  const activeStrokeStyles = replayPresentation?.strokeStyles ?? strokeStyles;
  const snapshot = useMemo(() => initialSnapshot
    ? {
      ...initialSnapshot,
      handedness: activeHandedness,
      strokeStyles: activeStrokeStyles ?? initialSnapshot.strokeStyles,
    }
    : null, [initialSnapshot, activeHandedness[0], activeHandedness[1], activeStrokeStyles]);
  const scoreTimeline = useMemo(
    () => viewer ? buildTe4DmoReplayScoreTimeline(viewer) : [],
    [viewer],
  );
  const nativeMotionNames = viewer
    ? characterNames
      ? alignDmoReplayPlayerStyles(
        submissionPlayers ?? viewer.names,
        viewer.names,
        characterNames,
      )
      : [viewer.names[0], viewer.names[1]] as const
    : [null, null] as const;
  const nativeMotion = useNativePlayerMotions({
    playerNames: nativeMotionNames,
    broadcastId,
    submissionId: replaySubmissionId,
    overridePlayerOrder: viewer && submissionPlayers
      ? dmoReplayPlayerStyleOrder(submissionPlayers, viewer.names)
      : [0, 1],
    allowAutomaticFallback,
  });

  useEffect(() => {
    const initialScore = te4DmoReplayScoreAtFrame(scoreTimeline, 0);
    replayScoreKeyRef.current = initialScore ? te4DmoReplayScoreKey(initialScore) : '';
    setReplayScore(initialScore);
  }, [scoreTimeline]);

  const handleReplayFrameChange = useCallback((frame: number) => {
    const nextScore = te4DmoReplayScoreAtFrame(scoreTimeline, frame);
    if (!nextScore) return;
    const nextKey = te4DmoReplayScoreKey(nextScore);
    if (nextKey === replayScoreKeyRef.current) return;
    replayScoreKeyRef.current = nextKey;
    setReplayScore(nextScore);
  }, [scoreTimeline]);

  useEffect(() => {
    let active = true;
    const prepare = async () => {
      setLoading(true);
      setError('');
      setView('court');
      setViewer(null);
      setInitialSnapshot(null);
      setReplayPresentation(null);
      setSrcDoc('');
      try {
        const dataUrl = replayUrl
          ?? (broadcastId ? `/api/live-dmo/${encodeURIComponent(broadcastId)}/replay` : '');
        if (!dataUrl) throw new Error('The replay could not be loaded.');
        const dataResponse = await fetch(dataUrl, { cache: 'no-store' });
        const payload = await dataResponse.json().catch(() => null);
        if (!dataResponse.ok) {
          throw new Error(typeof payload?.error === 'string' ? payload.error : 'The replay could not be loaded.');
        }
        if (!isViewerData(payload?.viewer)) throw new Error('The replay data is incomplete.');
        const replayPlayers = payload.viewer.names as [string, string];
        const metadataPlayers = submissionPlayers ?? replayPlayers;
        const replayHandedness = alignDmoReplayPlayerStyles(
          metadataPlayers,
          replayPlayers,
          handedness,
        );
        const replayStrokeStyles = strokeStyles
          ? alignDmoReplayPlayerStyles(metadataPlayers, replayPlayers, strokeStyles)
          : undefined;
        const nextSnapshot = te4ViewerToLiveSnapshot(payload.viewer, replayHandedness);
        if (!active) return;
        setViewer(payload.viewer);
        setInitialSnapshot(nextSnapshot);
        setReplayPresentation({
          handedness: replayHandedness,
          ...(replayStrokeStyles ? { strokeStyles: replayStrokeStyles } : {}),
        });
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'The replay could not be loaded.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void prepare();
    return () => {
      active = false;
    };
  }, [broadcastId, replayUrl]);

  useEffect(() => {
    if (view !== 'analysis' || !viewer) return;
    let active = true;
    const loadClassicPlayer = async () => {
      setClassicError('');
      setSrcDoc('');
      try {
        const response = await fetch('/te4-match-viewer-shell.html', { cache: 'force-cache' });
        if (!response.ok) throw new Error('The classic replay tools could not be loaded.');
        const shell = await response.text();
        if (!shell.includes('__DATA__') || !shell.includes('__HANDEDNESS__')) {
          throw new Error('The classic replay player template is incomplete.');
        }
        if (active) setSrcDoc(embedTe4ViewerHtml(shell, viewer, activeHandedness));
      } catch (cause) {
        if (active) setClassicError(cause instanceof Error ? cause.message : 'The classic replay tools could not be loaded.');
      }
    };
    void loadClassicPlayer();
    return () => {
      active = false;
    };
  }, [view, viewer, activeHandedness[0], activeHandedness[1]]);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'set-handedness', handedness: activeHandedness }, '*');
  }, [activeHandedness[0], activeHandedness[1]]);

  if (loading) {
    return <div className={styles.loading} role="status">Loading full 3D match replay…</div>;
  }
  if (error || !viewer || !snapshot) {
    return (
      <div className={styles.fallback}>
        <p role="alert">{error || 'The replay data is incomplete.'}{fallback ? ' Showing the live court summary instead.' : ''}</p>
        {fallback}
      </div>
    );
  }

  const replayScoreboard: StadiumScoreboardData = {
    players: viewer.names,
    score: replayScore ? {
      sets: replayScore.sets,
      games: replayScore.games,
      pointText: replayScore.pointText,
      tiebreak: replayScore.tiebreak,
      server: replayScore.server,
    } : null,
    live: false,
    final: replayScore?.final ?? false,
  };

  return (
    <section className={styles.replay}>
      <header className={styles.replayHeader}>
        <div className={styles.replayHeading}>
          <span className={styles.tourBadge}>
            {isWta === undefined ? 'TOUR UNVERIFIED' : isWta ? 'WTA' : 'ATP'} · FULL REPLAY
          </span>
          <h3>{viewer.names[0]} <i>vs</i> {viewer.names[1]}</h3>
          <p>{viewer.tournament || 'Tournament not recorded'} · {viewer.pts.length} points</p>
        </div>
        <div className={styles.viewTabs} role="group" aria-label="Replay view">
          <button
            type="button"
            aria-pressed={view === 'court'}
            onClick={() => setView('court')}
          >
            3D court
          </button>
          <button
            type="button"
            aria-pressed={view === 'analysis'}
            onClick={() => setView('analysis')}
          >
            Classic tools
          </button>
        </div>
      </header>
      {view === 'court' ? (
        <>
          <DmoLiveCourt3D
            key={`${broadcastId ?? replayUrl ?? 'replay'}:${viewer.names[0]}:${viewer.names[1]}:${nativeMotionNames.join(':')}`}
            snapshot={snapshot}
            surface={viewer.surface}
            playbackSpeed={initialSpeed}
            isWta={isWta ?? false}
            playerCharacters={nativeMotionNames}
            playerGruntSettings={nativeMotion.playerGruntSettings}
            tournamentRound={tournamentRound}
            fullReplay
            playerOutfitSeed={replayUrl || broadcastId || snapshot.filename}
            playerBundledMotions={nativeMotion.sources}
            scoreboard={replayScoreboard}
            onReplayFrameChange={handleReplayFrameChange}
          />
          {nativeMotion.error && (
            <p className={styles.classicError} role="status">{nativeMotion.error}</p>
          )}
          {replayScore && (
            <DmoReplayScoreBug players={viewer.names} score={replayScore} />
          )}
        </>
      ) : classicError ? (
        <p className={styles.classicError} role="alert">{classicError}</p>
      ) : srcDoc ? (
        <iframe
          ref={frameRef}
          className={styles.frame}
          title={`Classic match analysis: ${viewer.names[0]} vs ${viewer.names[1]}`}
          srcDoc={srcDoc}
          allow="fullscreen"
          allowFullScreen
          sandbox="allow-scripts"
          onLoad={() => {
            syncViewerTheme();
            frameRef.current?.contentWindow?.postMessage({ type: 'set-speed', speed: initialSpeed }, '*');
            frameRef.current?.contentWindow?.postMessage({ type: 'set-handedness', handedness: activeHandedness }, '*');
          }}
        />
      ) : (
        <div className={styles.loading} role="status">Loading classic replay tools…</div>
      )}
    </section>
  );
}
