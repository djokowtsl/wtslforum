'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  fallbackClassName: string;
};

function activeFullscreenElement() {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export default function CourtFullscreenButton({
  targetRef,
  className,
  statusClassName,
  fallbackClassName,
}: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState('');
  const savedPageStylesRef = useRef<{
    scrollY: number;
    bodyPosition: string;
    bodyTop: string;
    bodyWidth: string;
    bodyOverflow: string;
    htmlOverflow: string;
  } | null>(null);

  const restorePageStyles = useCallback(() => {
    const saved = savedPageStylesRef.current;
    if (!saved) return;
    document.body.style.position = saved.bodyPosition;
    document.body.style.top = saved.bodyTop;
    document.body.style.width = saved.bodyWidth;
    document.body.style.overflow = saved.bodyOverflow;
    document.documentElement.style.overflow = saved.htmlOverflow;
    window.scrollTo(0, saved.scrollY);
    savedPageStylesRef.current = null;
  }, []);

  const enterFallbackFullscreen = useCallback((target: HTMLElement) => {
    if (!savedPageStylesRef.current) {
      savedPageStylesRef.current = {
        scrollY: window.scrollY,
        bodyPosition: document.body.style.position,
        bodyTop: document.body.style.top,
        bodyWidth: document.body.style.width,
        bodyOverflow: document.body.style.overflow,
        htmlOverflow: document.documentElement.style.overflow,
      };
    }
    document.body.style.position = 'fixed';
    document.body.style.top = `-${window.scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    target.classList.add(fallbackClassName);
    setIsFullscreen(true);
  }, [fallbackClassName]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(
        activeFullscreenElement() === targetRef.current
        || targetRef.current?.classList.contains(fallbackClassName) === true,
      );
    };
    const exitFallback = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && targetRef.current?.classList.contains(fallbackClassName)) {
        targetRef.current.classList.remove(fallbackClassName);
        restorePageStyles();
        setIsFullscreen(false);
      }
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    document.addEventListener('keydown', exitFallback);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
      document.removeEventListener('keydown', exitFallback);
      targetRef.current?.classList.remove(fallbackClassName);
      restorePageStyles();
    };
  }, [fallbackClassName, restorePageStyles, targetRef]);

  const toggleFullscreen = async () => {
    const target = targetRef.current as FullscreenElement | null;
    if (!target) return;
    setError('');

    const doc = document as FullscreenDocument;
    try {
      if (activeFullscreenElement() === target || target.classList.contains(fallbackClassName)) {
        if (target.classList.contains(fallbackClassName)) {
          target.classList.remove(fallbackClassName);
          restorePageStyles();
          setIsFullscreen(false);
          return;
        }
        const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
        if (!exit) throw new Error('Fullscreen exit is not supported.');
        await exit.call(doc);
      } else {
        const request = target.requestFullscreen ?? target.webkitRequestFullscreen;
        if (!request) {
          enterFallbackFullscreen(target);
          return;
        }
        try {
          await request.call(target);
        } catch {
          enterFallbackFullscreen(target);
          return;
        }
      }
      setIsFullscreen(activeFullscreenElement() === target);
    } catch {
      if (target.isConnected) enterFallbackFullscreen(target);
      else setError('Full screen is unavailable in this browser.');
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
