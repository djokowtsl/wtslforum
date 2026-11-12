'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2, PictureInPicture2 } from 'lucide-react';

type ElementRef<T extends HTMLElement> = { current: T | null };
type PipMode = 'off' | 'native';
type PipVideo = HTMLVideoElement & {
  requestPictureInPicture?: () => Promise<unknown>;
  requestVideoFrameCallback?: (callback: (now: number, metadata: unknown) => void) => number;
  cancelVideoFrameCallback?: (callbackId: number) => void;
  webkitPresentationMode?: 'inline' | 'picture-in-picture' | 'fullscreen';
  webkitSupportsPresentationMode?: (mode: 'picture-in-picture') => boolean;
  webkitSetPresentationMode?: (mode: 'inline' | 'picture-in-picture') => void;
};
type PipDocument = Document & {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: Element | null;
  exitPictureInPicture?: () => Promise<void>;
};

type Props = {
  canvasRef: ElementRef<HTMLCanvasElement>;
  mediaVideoRef?: ElementRef<HTMLVideoElement>;
  className: string;
  statusClassName: string;
  videoClassName: string;
};

function isIOSHomeScreenApp() {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = nav.standalone === true
    || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return isIOS && isStandalone;
}

function waitForVideoFrame(video: PipVideo) {
  return new Promise<void>((resolve, reject) => {
    let timeout = 0;
    let frameCallback: number | null = null;
    let frameCount = 0;
    const hasVideoData = () => (
      video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0
    );
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      if (frameCallback !== null) {
        video.cancelVideoFrameCallback?.(frameCallback);
        frameCallback = null;
      }
      video.removeEventListener('loadeddata', check);
      video.removeEventListener('playing', check);
      video.removeEventListener('resize', check);
      if (error) reject(error);
      else resolve();
    };
    const onVideoFrame = () => {
      frameCallback = null;
      if (hasVideoData()) frameCount += 1;
      if (frameCount >= 2) finish();
      else check();
    };
    const check = () => {
      if (!hasVideoData()) return;
      if (!video.requestVideoFrameCallback) {
        finish();
        return;
      }
      if (frameCallback === null) {
        frameCallback = video.requestVideoFrameCallback(onVideoFrame);
      }
    };
    timeout = window.setTimeout(
      () => finish(new Error('The court video did not produce two frames.')),
      5000,
    );
    video.addEventListener('loadeddata', check);
    video.addEventListener('playing', check);
    video.addEventListener('resize', check);
    check();
  });
}

function requestWebkitPictureInPicture(video: PipVideo) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      video.removeEventListener('webkitpresentationmodechanged', check);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (video.webkitPresentationMode === 'picture-in-picture') finish();
    };
    const timeout = window.setTimeout(
      () => finish(new Error('Safari did not open its Picture in Picture window.')),
      3000,
    );
    video.addEventListener('webkitpresentationmodechanged', check);
    try {
      video.webkitSetPresentationMode?.('picture-in-picture');
      check();
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Picture in Picture could not start.'));
    }
  });
}

export default function CourtPictureInPictureButton({
  canvasRef,
  mediaVideoRef,
  className,
  statusClassName,
  videoClassName,
}: Props) {
  const videoRef = useRef<PipVideo | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modeRef = useRef<PipMode>('off');
  const videoReadyRef = useRef(false);
  const preparationPromiseRef = useRef<Promise<void> | null>(null);
  const [mode, setMode] = useState<PipMode>('off');
  const [videoReady, setVideoReady] = useState(false);
  const [isPreparingVideo, setIsPreparingVideo] = useState(false);
  const [error, setError] = useState('');
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  const setVideoElement = useCallback((video: PipVideo | null) => {
    videoRef.current = video;
    if (mediaVideoRef) mediaVideoRef.current = video;
  }, [mediaVideoRef]);

  const setPipMode = (next: PipMode) => {
    modeRef.current = next;
    setMode(next);
  };

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  const startVideoPreparation = useCallback(() => {
    const video = videoRef.current;
    if (!video || videoReadyRef.current || preparationPromiseRef.current) return;

    setIsPreparingVideo(true);
    let playResult: Promise<void> | void;
    try {
      playResult = video.play();
    } catch (reason) {
      setIsPreparingVideo(false);
      setError(reason instanceof Error
        ? `Picture in Picture preview could not start: ${reason.message}`
        : 'Picture in Picture preview could not start.');
      return;
    }

    let preparation: Promise<void>;
    preparation = Promise.resolve(playResult)
      .then(() => waitForVideoFrame(video))
      .then(() => {
        if (videoRef.current !== video) return;
        videoReadyRef.current = true;
        setVideoReady(true);
        setError('');
      })
      .catch((reason: unknown) => {
        if (videoRef.current !== video) return;
        setError(reason instanceof Error
          ? `Picture in Picture preview could not start: ${reason.message}`
          : 'Picture in Picture preview could not start.');
      })
      .finally(() => {
        if (preparationPromiseRef.current === preparation) {
          preparationPromiseRef.current = null;
        }
        setIsPreparingVideo(false);
      });
    preparationPromiseRef.current = preparation;
  }, []);

  const stopStream = () => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  };

  const exitPictureInPicture = async () => {
    const doc = document as PipDocument;
    const video = videoRef.current;
    setPipMode('off');
    if (video && doc.pictureInPictureElement === video && doc.exitPictureInPicture) {
      try {
        await doc.exitPictureInPicture();
      } catch {
        // The browser may already have closed its floating video window.
      }
    } else if (video?.webkitPresentationMode === 'picture-in-picture') {
      try {
        video.webkitSetPresentationMode?.('inline');
      } catch {
        // The browser may already have closed its floating video window.
      }
    }
  };

  useEffect(() => {
    if (!portalRoot) return;
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let preparationStarted = false;
    let preparationFrame = 0;
    const prepareVideo = () => {
      if (disposed || preparationStarted) return;
      const canvas = canvasRef.current as (HTMLCanvasElement & {
        captureStream?: (frameRate?: number) => MediaStream;
      }) | null;
      if (!canvas || !video || !canvas.width || !canvas.height) {
        preparationFrame = window.requestAnimationFrame(prepareVideo);
        return;
      }
      if (typeof canvas.captureStream !== 'function') {
        setError('System Picture in Picture is unavailable for this court view.');
        return;
      }
      preparationStarted = true;
      try {
        const stream = canvas.captureStream(30);
        if (!stream.getVideoTracks().length) {
          stream.getTracks().forEach(track => track.stop());
          throw new Error('The court canvas did not provide a video track.');
        }
        streamRef.current = stream;
        video.muted = true;
        video.playsInline = true;
        // WebKit may fail to promote a MediaStream-backed video to native PiP
        // unless controls are enabled while its source is attached.
        video.controls = true;
        video.srcObject = stream;
        video.controls = false;
        video.disablePictureInPicture = false;
        startVideoPreparation();
      } catch (reason) {
        setError(reason instanceof Error
          ? reason.message
          : 'Picture in Picture preview could not start.');
      }
    };
    const onEnterPictureInPicture = () => setPipMode('native');
    const onLeavePictureInPicture = () => {
      if (video) video.controls = false;
      setPipMode('off');
    };
    const onWebkitPresentationModeChange = () => {
      if (video?.webkitPresentationMode === 'picture-in-picture') {
        setPipMode('native');
      } else {
        if (video) video.controls = false;
        if (modeRef.current === 'native') setPipMode('off');
      }
    };
    video?.addEventListener('enterpictureinpicture', onEnterPictureInPicture);
    video?.addEventListener('leavepictureinpicture', onLeavePictureInPicture);
    video?.addEventListener('webkitpresentationmodechanged', onWebkitPresentationModeChange);
    preparationFrame = window.requestAnimationFrame(prepareVideo);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(preparationFrame);
      video?.removeEventListener('enterpictureinpicture', onEnterPictureInPicture);
      video?.removeEventListener('leavepictureinpicture', onLeavePictureInPicture);
      video?.removeEventListener('webkitpresentationmodechanged', onWebkitPresentationModeChange);
      if (video?.webkitPresentationMode === 'picture-in-picture') {
        video.webkitSetPresentationMode?.('inline');
      }
      if (video) video.controls = false;
      videoReadyRef.current = false;
      preparationPromiseRef.current = null;
      stopStream();
    };
    // This effect owns the captured canvas preview and its video element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, portalRoot, startVideoPreparation]);

  const togglePictureInPicture = () => {
    if (modeRef.current !== 'off') {
      void exitPictureInPicture();
      return;
    }
    setError('');
    const video = videoRef.current;
    if (isIOSHomeScreenApp()) {
      setError('Picture in Picture is unavailable from an iPhone Home Screen app. Open this page in Safari to use it.');
      return;
    }
    if (!video || !streamRef.current) {
      setError('The court video is still preparing. Try again in a moment.');
      return;
    }
    if (!videoReadyRef.current) {
      setError('The court video is still preparing. Picture in Picture will be available when it has a frame.');
      return;
    }

    const doc = document as PipDocument;
    const supportsStandardPip = doc.pictureInPictureEnabled
      && typeof video.requestPictureInPicture === 'function';
    const supportsWebkitPip = video.webkitSupportsPresentationMode?.('picture-in-picture') === true
      && typeof video.webkitSetPresentationMode === 'function';
    if (!supportsStandardPip && !supportsWebkitPip) {
      setError('This browser cannot open a system Picture in Picture window. Open the page in Safari or a supported browser.');
      return;
    }

    try {
      if (supportsWebkitPip) video.controls = true;
      // The video is already playing before this button is enabled. Make the
      // browser request the first operation in this click so Safari retains
      // the transient user activation required to open its native PiP window.
      const pictureInPicture = supportsWebkitPip
        ? requestWebkitPictureInPicture(video)
        : video.requestPictureInPicture!();
      void pictureInPicture.then(() => {
        setError('');
        setPipMode('native');
      }).catch((reason: unknown) => {
        setPipMode('off');
        if (supportsWebkitPip) video.controls = false;
        setError(reason instanceof Error
          ? `${reason.message} Tap PiP to try again.`
          : 'System Picture in Picture could not start. Tap PiP to try again.');
      });
    } catch (reason) {
      setPipMode('off');
      if (supportsWebkitPip) video.controls = false;
      setError(reason instanceof Error
        ? `${reason.message} Tap PiP to try again.`
        : 'System Picture in Picture could not start. Tap PiP to try again.');
    }
  };

  const isActive = mode !== 'off';

  return (
    <>
      <button
        className={className}
        data-pip-toggle
        type="button"
        aria-label={isActive
          ? 'Close system picture in picture'
          : videoReady ? 'Open system picture in picture' : 'Prepare court video for Picture in Picture'}
        aria-pressed={isActive}
        title={isActive
          ? 'Close system picture in picture'
          : videoReady
            ? 'Open system picture in picture'
            : isPreparingVideo ? 'Preparing court video for Picture in Picture' : 'Picture in Picture is unavailable until the court video is ready'}
        disabled={!videoReady}
        onClick={togglePictureInPicture}
      >
        {isActive
          ? <Minimize2 size={15} aria-hidden="true" />
          : <PictureInPicture2 size={15} aria-hidden="true" />}
        <span>{isActive ? 'PiP on' : videoReady ? 'PiP' : isPreparingVideo ? 'Preparing PiP' : 'PiP unavailable'}</span>
      </button>
      {portalRoot && createPortal(
        <video
          ref={setVideoElement}
          className={videoClassName}
          muted
          playsInline
          autoPlay
          aria-hidden="true"
        />,
        portalRoot,
      )}
      {error && <span className={statusClassName} role="status">{error}</span>}
    </>
  );
}
