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

type LandscapeOrientation = {
  lock?: (orientation: 'landscape') => Promise<void> | void;
  unlock?: () => void;
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
  const orientationLockRequestedRef = useRef(false);
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

  const requestLandscapeLock = useCallback(async (enabled: boolean) => {
    if (!enabled) return;
    const orientation = (window.screen as unknown as { orientation?: LandscapeOrientation }).orientation;
    if (!orientation?.lock) return;
    try {
      await orientation.lock('landscape');
      orientationLockRequestedRef.current = true;
      const stillFullscreen = activeFullscreenElement() === targetRef.current
        || targetRef.current?.classList.contains(fallbackClassName) === true
        || videoRef?.current?.webkitDisplayingFullscreen === true;
      if (!stillFullscreen) {
        try {
          orientation.unlock?.();
        } catch {
          // Ignore a lock that the browser has already released.
        }
        orientationLockRequestedRef.current = false;
      }
    } catch {
      // Some browsers allow fullscreen but do not expose orientation locking.
    }
  }, [fallbackClassName, targetRef, videoRef]);

  const releaseLandscapeLock = useCallback(() => {
    if (!orientationLockRequestedRef.current) return;
    const orientation = (window.screen as unknown as { orientation?: LandscapeOrientation }).orientation;
    try {
      orientation?.unlock?.();
    } catch {
      // The browser may have already released its orientation lock.
    }
    orientationLockRequestedRef.current = false;
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
      const fullscreen = (
        activeFullscreenElement() === targetRef.current
        || targetRef.current?.classList.contains(fallbackClassName) === true
        || video?.webkitDisplayingFullscreen === true
      );
      setIsFullscreen(fullscreen);
      if (!fullscreen) releaseLandscapeLock();
    };
    const onNativeVideoFullscreenStart = () => setIsFullscreen(true);
    const onNativeVideoFullscreenEnd = () => {
      if (video) video.controls = false;
      setIsFullscreen(false);
      releaseLandscapeLock();
    };
    const exitFallback = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && targetRef.current?.classList.contains(fallbackClassName)) {
        targetRef.current.classList.remove(fallbackClassName);
        restoreAncestorStyles();
        restorePageStyles();
        releaseLandscapeLock();
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
      releaseLandscapeLock();
    };
  }, [fallbackClassName, releaseLandscapeLock, restoreAncestorStyles, restorePageStyles, targetRef, videoRef]);

  const toggleFullscreen = async () => {
    const target = targetRef.current as FullscreenElement | null;
    if (!target) return;
    setError('');
    const shouldLockLandscape = window.matchMedia('(max-width: 900px)').matches;

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
          releaseLandscapeLock();
          setIsFullscreen(false);
          return;
        }
        const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
        if (!exit) throw new Error('Fullscreen exit is not supported.');
        await exit.call(doc);
        releaseLandscapeLock();
      } else {
        const request = target.requestFullscreen ?? target.webkitRequestFullscreen;
        if (!request) {
          if (enterNativeVideoFullscreen()) {
            void requestLandscapeLock(shouldLockLandscape);
            return;
          }
          enterFallbackFullscreen(target);
          void requestLandscapeLock(shouldLockLandscape);
          return;
        }
        try {
          await request.call(target);
          await requestLandscapeLock(shouldLockLandscape);
        } catch {
          if (enterNativeVideoFullscreen()) {
            void requestLandscapeLock(shouldLockLandscape);
            return;
          }
          enterFallbackFullscreen(target);
          void requestLandscapeLock(shouldLockLandscape);
          return;
        }
      }
      setIsFullscreen(activeFullscreenElement() === target);
    } catch {
      if (enterNativeVideoFullscreen()) {
        void requestLandscapeLock(shouldLockLandscape);
        return;
      }
      if (target.isConnected) {
        enterFallbackFullscreen(target);
        void requestLandscapeLock(shouldLockLandscape);
      }
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
