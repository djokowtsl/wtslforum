'use client';

import { useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

type FullscreenTargetRef = {
  current: HTMLElement | null;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type Props = {
  targetRef: FullscreenTargetRef;
  className: string;
  statusClassName: string;
};

function activeFullscreenElement() {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export default function CourtFullscreenButton({
  targetRef,
  className,
  statusClassName,
}: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(activeFullscreenElement() === targetRef.current);
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
    };
  }, [targetRef]);

  const toggleFullscreen = async () => {
    const target = targetRef.current as FullscreenElement | null;
    if (!target) return;
    setError('');

    const doc = document as FullscreenDocument;
    try {
      if (activeFullscreenElement() === target) {
        const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
        if (!exit) throw new Error('Fullscreen exit is not supported.');
        await exit.call(doc);
      } else {
        const request = target.requestFullscreen ?? target.webkitRequestFullscreen;
        if (!request) throw new Error('Fullscreen is not supported.');
        await request.call(target);
      }
      setIsFullscreen(activeFullscreenElement() === target);
    } catch {
      setError('Full screen is unavailable in this browser.');
    }
  };

  return (
    <>
      <button
        className={className}
        type="button"
        aria-label={isFullscreen ? 'Exit full screen' : 'Watch full screen'}
        aria-pressed={isFullscreen}
        title={isFullscreen ? 'Exit full screen' : 'Watch full screen'}
        onClick={() => void toggleFullscreen()}
      >
        {isFullscreen
          ? <Minimize2 size={15} aria-hidden="true" />
          : <Maximize2 size={15} aria-hidden="true" />}
        <span>{isFullscreen ? 'Exit full screen' : 'Full screen'}</span>
      </button>
      {error && <span className={statusClassName} role="status">{error}</span>}
    </>
  );
}
