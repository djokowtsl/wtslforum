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

type FullscreenVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
};

type FullscreenVideoRef = {
  current: FullscreenVideo | null;
};

type Props = {
  targetRef: FullscreenTargetRef;
  videoRef?: FullscreenVideoRef;
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
  videoRef,
  className,
  statusClassName,
  fallbackClassName,
}: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState('');
  const ancestorStylesRef = useRef<Array<{ element: HTMLElement; style: string | null }>>([]);
  const savedPageStylesRef = useRef<{
    scrollY: number;
    bodyPosition: string;
    bodyTop: string;
    bodyWidth: string;
    bodyOverflow: string;
    htmlOverflow: string;
  } | null>(null);

  const relaxClippingAncestors = useCallback((target: HTMLElement) => {
    const snapshots: Array<{ element: HTMLElement; style: string | null }> = [];
    let ancestor = target.parentElement;
    while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
      const computed = window.getComputedStyle(ancestor);
      const clips = [computed.overflowX, computed.overflowY]
        .some(value => value !== 'visible' && value !== 'unset');
      const establishesFixedContainingBlock = computed.transform !== 'none'
        || computed.filter !== 'none'
        || computed.perspective !== 'none'
        || computed.contain !== 'none'
        || computed.willChange.split(',').some(value => value.trim() === 'transform');
      if (clips || establishesFixedContainingBlock) {
        snapshots.push({ element: ancestor, style: ancestor.getAttribute('style') });
        if (clips) ancestor.style.setProperty('overflow', 'visible', 'important');
        if (computed.transform !== 'none') ancestor.style.setProperty('transform', 'none', 'important');
        if (computed.filter !== 'none') ancestor.style.setProperty('filter', 'none', 'important');
        if (computed.perspective !== 'none') ancestor.style.setProperty('perspective', 'none', 'important');
        if (computed.contain !== 'none') ancestor.style.setProperty('contain', 'none', 'important');
        if (computed.willChange.split(',').some(value => value.trim() === 'transform')) {
          ancestor.style.setProperty('will-change', 'auto', 'important');
        }
      }
      ancestor = ancestor.parentElement;
    }
    ancestorStylesRef.current = snapshots;
  }, []);

  const restoreAncestorStyles = useCallback(() => {
    for (const snapshot of ancestorStylesRef.current.reverse()) {
      if (snapshot.style === null) snapshot.element.removeAttribute('style');
      else snapshot.element.setAttribute('style', snapshot.style);
    }
    ancestorStylesRef.current = [];
  }, []);

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
    relaxClippingAncestors(target);
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
  }, [fallbackClassName, relaxClippingAncestors]);

  useEffect(() => {
    const video = videoRef?.current;
    const syncFullscreenState = () => {
      setIsFullscreen(
        activeFullscreenElement() === targetRef.current
        || targetRef.current?.classList.contains(fallbackClassName) === true
        || video?.webkitDisplayingFullscreen === true,
      );
    };
    const onNativeVideoFullscreenStart = () => setIsFullscreen(true);
    const onNativeVideoFullscreenEnd = () => {
      if (video) video.controls = false;
      setIsFullscreen(false);
    };
    const exitFallback = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && targetRef.current?.classList.contains(fallbackClassName)) {
        targetRef.current.classList.remove(fallbackClassName);
        restoreAncestorStyles();
        restorePageStyles();
        setIsFullscreen(false);
      }
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('webkitfullscreenchange', syncFullscreenState);
    document.addEventListener('keydown', exitFallback);
    video?.addEventListener('webkitbeginfullscreen', onNativeVideoFullscreenStart);
    video?.addEventListener('webkitendfullscreen', onNativeVideoFullscreenEnd);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('webkitfullscreenchange', syncFullscreenState);
      document.removeEventListener('keydown', exitFallback);
      video?.removeEventListener('webkitbeginfullscreen', onNativeVideoFullscreenStart);
      video?.removeEventListener('webkitendfullscreen', onNativeVideoFullscreenEnd);
      targetRef.current?.classList.remove(fallbackClassName);
      restoreAncestorStyles();
      restorePageStyles();
    };
  }, [fallbackClassName, restoreAncestorStyles, restorePageStyles, targetRef, videoRef]);

  const toggleFullscreen = async () => {
    const target = targetRef.current as FullscreenElement | null;
    if (!target) return;
    setError('');

    const doc = document as FullscreenDocument;
    const enterNativeVideoFullscreen = () => {
      const video = videoRef?.current;
      if (!video?.webkitEnterFullscreen || video.readyState < 2 || video.videoWidth <= 0) {
        return false;
      }
      try {
        video.controls = true;
        video.webkitEnterFullscreen();
        setIsFullscreen(true);
        return true;
      } catch {
        video.controls = false;
        return false;
      }
    };

    try {
      if (activeFullscreenElement() === target || target.classList.contains(fallbackClassName)) {
        if (target.classList.contains(fallbackClassName)) {
          target.classList.remove(fallbackClassName);
          restoreAncestorStyles();
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
          if (enterNativeVideoFullscreen()) return;
          enterFallbackFullscreen(target);
          return;
        }
        try {
          await request.call(target);
        } catch {
          if (enterNativeVideoFullscreen()) return;
          enterFallbackFullscreen(target);
          return;
        }
      }
      setIsFullscreen(activeFullscreenElement() === target);
    } catch {
      if (enterNativeVideoFullscreen()) return;
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
