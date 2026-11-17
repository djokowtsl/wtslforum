'use client';

import { useEffect, useRef, useState } from 'react';
import { embedTe4ViewerHtml } from '@/lib/te4ViewerEmbed';
import type { Te4ViewerData } from '@/lib/te4DmoTypes';
import { useTe4ViewerTheme } from '@/components/useTe4ViewerTheme';
import styles from './CoachingReportReplay.module.css';
import viewerStyles from './Te4DmoReplayPlayer.module.css';

type Props = {
  reportId: string;
  players: [string, string];
};

export default function CoachingReportReplay({ reportId, players }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState('');
  const [viewer, setViewer] = useState<Te4ViewerData | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [error, setError] = useState('');
  const syncViewerTheme = useTe4ViewerTheme(frameRef);
  const title = `Coaching report replay: ${players[0]} vs ${players[1]}`;

  useEffect(() => {
    let active = true;
    const loadReplay = async () => {
      setError('');
      setSrcDoc('');
      setViewer(null);
      setSelectedPoint(null);
      try {
        const [dataResponse, shellResponse] = await Promise.all([
          fetch(`/api/coaching-reports/${reportId}/replay`, { cache: 'no-store' }),
          fetch('/te4-match-viewer-shell.html', { cache: 'force-cache' }),
        ]);
        const payload = await dataResponse.json().catch(() => null);
        if (!dataResponse.ok) {
          throw new Error(
            typeof payload?.error === 'string'
              ? payload.error
              : 'The replay could not be loaded.',
          );
        }
        if (!shellResponse.ok) throw new Error('The replay player could not be loaded.');
        const viewer = payload as Te4ViewerData;
        if (!Array.isArray(viewer?.names) || typeof viewer.match?.d !== 'string') {
          throw new Error('The replay data is incomplete.');
        }
        const shell = await shellResponse.text();
        if (active) {
          setViewer(viewer);
          setSrcDoc(embedTe4ViewerHtml(shell, viewer));
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'The replay could not be loaded.');
      }
    };
    void loadReplay();
    return () => {
      active = false;
    };
  }, [reportId]);

  const selectHighlight = (point: number) => {
    setSelectedPoint(point);
    frameRef.current?.contentWindow?.postMessage({ type: 'select-point', point }, '*');
  };

  if (error) {
    return <div className={viewerStyles.fallback} role="alert"><p>{error}</p></div>;
  }
  if (!srcDoc) {
    return <div className={viewerStyles.loading} role="status">Loading the approved match replay…</div>;
  }
  return (
    <div className={styles.reportReplay}>
      <div className={viewerStyles.frameWrap}>
        <iframe
          ref={frameRef}
          className={viewerStyles.frame}
          title={title}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          onLoad={syncViewerTheme}
        />
      </div>
      {viewer?.highlights.length ? (
        <section className={styles.moments} aria-label="Match highlights">
          <div className={styles.momentsHeading}>
            <h3>Key moments from this match</h3>
            <p>Select a moment to jump the replay to that point.</p>
          </div>
          <ul>
            {viewer.highlights.slice(0, 8).map((highlight) => (
              <li key={`${highlight.point}-${highlight.frame}`}>
                <button
                  type="button"
                  aria-pressed={selectedPoint === highlight.point}
                  onClick={() => selectHighlight(highlight.point)}
                >
                  <strong>{highlight.rewatch || highlight.reasons || `Point ${highlight.point}`}</strong>
                  <span>
                    Set {highlight.set} · Game {highlight.games} · {viewer.names[highlight.winner - 1]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
