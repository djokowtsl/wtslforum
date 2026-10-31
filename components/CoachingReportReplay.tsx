'use client';

import { useEffect, useRef, useState } from 'react';
import type { Te4ViewerData } from '@/lib/te4DmoTypes';
import styles from './Te4DmoReplayPlayer.module.css';

type Props = {
  reportId: string;
  players: [string, string];
};

function embedViewerData(html: string, viewer: Te4ViewerData): string {
  const json = JSON.stringify(viewer)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return html.replace('__DATA__', json).replace('__HANDEDNESS__', '["right","right"]');
}

export default function CoachingReportReplay({ reportId, players }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState('');
  const [error, setError] = useState('');
  const title = `Coaching report replay: ${players[0]} vs ${players[1]}`;

  useEffect(() => {
    let active = true;
    const loadReplay = async () => {
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
        if (!shell.includes('__DATA__') || !shell.includes('__HANDEDNESS__')) {
          throw new Error('The replay player template is incomplete.');
        }
        if (active) setSrcDoc(embedViewerData(shell, viewer));
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'The replay could not be loaded.');
      }
    };
    void loadReplay();
    return () => {
      active = false;
    };
  }, [reportId]);

  if (error) {
    return <div className={styles.fallback} role="alert"><p>{error}</p></div>;
  }
  if (!srcDoc) {
    return <div className={styles.loading} role="status">Loading the approved match replay…</div>;
  }
  return (
    <div className={styles.frameWrap}>
      <iframe
        ref={frameRef}
        className={styles.frame}
        title={title}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
      />
    </div>
  );
}
