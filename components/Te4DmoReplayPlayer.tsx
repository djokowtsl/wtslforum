'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Te4ViewerData } from '@/lib/te4DmoTypes';
import styles from './Te4DmoReplayPlayer.module.css';

type Props = {
  broadcastId: string;
  initialSpeed: 1 | 2 | 4;
  handedness: ['left' | 'right', 'left' | 'right'];
  fallback: ReactNode;
};

function embedViewerData(
  html: string,
  viewer: Te4ViewerData,
  handedness: ['left' | 'right', 'left' | 'right'],
): string {
  const json = JSON.stringify(viewer)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const handsJson = JSON.stringify(handedness).replace(/</g, '\\u003c');
  return html.replace('__DATA__', json).replace('__HANDEDNESS__', handsJson);
}

export default function Te4DmoReplayPlayer({ broadcastId, initialSpeed, handedness, fallback }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState('');
  const [title, setTitle] = useState('Full match DMO replay');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const prepare = async () => {
      try {
        const [dataResponse, shellResponse] = await Promise.all([
          fetch(`/api/live-dmo/${broadcastId}/replay`, { cache: 'no-store' }),
          fetch('/te4-match-viewer-shell.html', { cache: 'force-cache' }),
        ]);
        const payload = await dataResponse.json().catch(() => null);
        if (!dataResponse.ok) {
          throw new Error(typeof payload?.error === 'string' ? payload.error : 'The replay could not be loaded.');
        }
        if (!shellResponse.ok) throw new Error('The replay player could not be loaded.');
        const viewer = payload?.viewer as Te4ViewerData | undefined;
        if (!viewer || !Array.isArray(viewer.names) || typeof viewer.match?.d !== 'string') {
          throw new Error('The replay data is incomplete.');
        }
        const shell = await shellResponse.text();
        if (!shell.includes('__DATA__') || !shell.includes('__HANDEDNESS__')) {
          throw new Error('The replay player template is incomplete.');
        }
        if (!active) return;
        setTitle(`Match replay: ${viewer.names[0]} vs ${viewer.names[1]}`);
        setSrcDoc(embedViewerData(shell, viewer, handedness));
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'The replay could not be loaded.');
      }
    };
    void prepare();
    return () => {
      active = false;
    };
  }, [broadcastId]);

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ type: 'set-handedness', handedness }, '*');
  }, [handedness[0], handedness[1]]);

  if (error) {
    return (
      <div className={styles.fallback}>
        <p role="alert">{error} Showing the live court summary instead.</p>
        {fallback}
      </div>
    );
  }

  if (!srcDoc) {
    return <div className={styles.loading} role="status">Loading full replay controls and sound…</div>;
  }

  return (
    <div className={styles.frameWrap}>
      <iframe
        ref={frameRef}
        className={styles.frame}
        title={title}
        srcDoc={srcDoc}
        sandbox="allow-scripts"
        onLoad={() => {
          frameRef.current?.contentWindow?.postMessage({ type: 'set-speed', speed: initialSpeed }, '*');
          frameRef.current?.contentWindow?.postMessage({ type: 'set-handedness', handedness }, '*');
        }}
      />
    </div>
  );
}
