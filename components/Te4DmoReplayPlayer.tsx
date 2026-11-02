'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { embedTe4ViewerHtml } from '@/lib/te4ViewerEmbed';
import { te4ViewerToLiveSnapshot } from '@/lib/te4DmoReplaySnapshot';
import type { Te4LiveSnapshot } from '@/lib/te4DmoLive';
import type { Te4ViewerData } from '@/lib/te4DmoTypes';
import { useTe4ViewerTheme } from '@/components/useTe4ViewerTheme';
import DmoLiveCourt3D from './DmoLiveCourt3D';
import styles from './Te4DmoReplayPlayer.module.css';

type Props = {
  broadcastId: string;
  initialSpeed: 1 | 2 | 4;
  isWta: boolean;
  handedness: ['left' | 'right', 'left' | 'right'];
  fallback: ReactNode;
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
  initialSpeed,
  isWta,
  handedness,
  fallback,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [viewer, setViewer] = useState<Te4ViewerData | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<Te4LiveSnapshot | null>(null);
  const [view, setView] = useState<'court' | 'analysis'>('court');
  const [srcDoc, setSrcDoc] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [classicError, setClassicError] = useState('');
  const syncViewerTheme = useTe4ViewerTheme(frameRef);
  const snapshot = useMemo(() => initialSnapshot
    ? { ...initialSnapshot, handedness }
    : null, [initialSnapshot, handedness[0], handedness[1]]);

  useEffect(() => {
    let active = true;
    const prepare = async () => {
      setLoading(true);
      setError('');
      setView('court');
      setViewer(null);
      setInitialSnapshot(null);
      setSrcDoc('');
      try {
        const response = await fetch(`/api/live-dmo/${broadcastId}/replay`, { cache: 'no-store' });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(typeof payload?.error === 'string' ? payload.error : 'The replay could not be loaded.');
        }
        if (!isViewerData(payload?.viewer)) throw new Error('The replay data is incomplete.');
        const nextSnapshot = te4ViewerToLiveSnapshot(payload.viewer, ['right', 'right']);
        if (!active) return;
        setViewer(payload.viewer);
        setInitialSnapshot(nextSnapshot);
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
  }, [broadcastId]);

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
        if (active) setSrcDoc(embedTe4ViewerHtml(shell, viewer, handedness));
      } catch (cause) {
        if (active) setClassicError(cause instanceof Error ? cause.message : 'The classic replay tools could not be loaded.');
      }
    };
    void loadClassicPlayer();
    return () => {
      active = false;
    };
  }, [view, viewer, handedness[0], handedness[1]]);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'set-handedness', handedness }, '*');
  }, [handedness[0], handedness[1]]);

  if (loading) {
    return <div className={styles.loading} role="status">Loading full 3D match replay…</div>;
  }
  if (error || !viewer || !snapshot) {
    return (
      <div className={styles.fallback}>
        <p role="alert">{error || 'The replay data is incomplete.'} Showing the live court summary instead.</p>
        {fallback}
      </div>
    );
  }

  return (
    <section className={styles.replay}>
      <header className={styles.replayHeader}>
        <div className={styles.replayHeading}>
          <span className={styles.tourBadge}>{isWta ? 'WTA' : 'ATP'} · FULL REPLAY</span>
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
        <DmoLiveCourt3D
          snapshot={snapshot}
          surface={viewer.surface}
          playbackSpeed={initialSpeed}
          isWta={isWta}
          fullReplay
        />
      ) : classicError ? (
        <p className={styles.classicError} role="alert">{classicError}</p>
      ) : srcDoc ? (
        <iframe
          ref={frameRef}
          className={styles.frame}
          title={`Classic match analysis: ${viewer.names[0]} vs ${viewer.names[1]}`}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          onLoad={() => {
            syncViewerTheme();
            frameRef.current?.contentWindow?.postMessage({ type: 'set-speed', speed: initialSpeed }, '*');
            frameRef.current?.contentWindow?.postMessage({ type: 'set-handedness', handedness }, '*');
          }}
        />
      ) : (
        <div className={styles.loading} role="status">Loading classic replay tools…</div>
      )}
    </section>
  );
}
