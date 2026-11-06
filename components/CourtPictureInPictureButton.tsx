'use client';

import { useEffect, useRef, useState } from 'react';
import { Minimize2, PictureInPicture2 } from 'lucide-react';

type ElementRef<T extends HTMLElement> = { current: T | null };
type PipMode = 'off' | 'native' | 'inline' | 'mini';
type PipVideo = HTMLVideoElement & {
  requestPictureInPicture?: () => Promise<unknown>;
};
type PipDocument = Document & {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: Element | null;
  exitPictureInPicture?: () => Promise<void>;
};

type Props = {
  canvasRef: ElementRef<HTMLCanvasElement>;
  targetRef: ElementRef<HTMLElement>;
  className: string;
  statusClassName: string;
  fallbackClassName: string;
  overlayClassName: string;
  activeOverlayClassName: string;
  videoClassName: string;
  sourceClassName: string;
  closeClassName: string;
};

export default function CourtPictureInPictureButton({
  canvasRef,
  targetRef,
  className,
  statusClassName,
  fallbackClassName,
  overlayClassName,
  activeOverlayClassName,
  videoClassName,
  sourceClassName,
  closeClassName,
}: Props) {
  const videoRef = useRef<PipVideo | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modeRef = useRef<PipMode>('off');
  const [mode, setMode] = useState<PipMode>('off');
  const [error, setError] = useState('');

  const setPipMode = (next: PipMode) => {
    modeRef.current = next;
    setMode(next);
  };

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
    if (modeRef.current === 'native' && doc.pictureInPictureElement && doc.exitPictureInPicture) {
      try {
        await doc.exitPictureInPicture();
      } catch {
        // The browser may already have closed its floating video window.
      }
    }
    targetRef.current?.classList.remove(fallbackClassName);
    stopStream();
    setPipMode('off');
  };

  useEffect(() => {
    const video = videoRef.current;
    const onLeavePictureInPicture = () => {
      stopStream();
      setPipMode('off');
    };
    video?.addEventListener('leavepictureinpicture', onLeavePictureInPicture);
    return () => {
      video?.removeEventListener('leavepictureinpicture', onLeavePictureInPicture);
      targetRef.current?.classList.remove(fallbackClassName);
      stopStream();
    };
  }, [fallbackClassName, targetRef]);

  const togglePictureInPicture = async () => {
    if (modeRef.current !== 'off') {
      await exitPictureInPicture();
      return;
    }
    setError('');
    const canvas = canvasRef.current as (HTMLCanvasElement & {
      captureStream?: (frameRate?: number) => MediaStream;
    }) | null;
    const target = targetRef.current;
    const video = videoRef.current;
    if (!canvas || !target || !video || typeof canvas.captureStream !== 'function') {
      if (target) {
        target.classList.add(fallbackClassName);
        setPipMode('mini');
      } else {
        setError('Picture in picture is unavailable in this browser.');
      }
      return;
    }

    try {
      const stream = canvas.captureStream(30);
      streamRef.current = stream;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      const playback = video.play();
      const doc = document as PipDocument;
      if (doc.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') {
        try {
          const pictureInPicture = video.requestPictureInPicture();
          await Promise.all([playback, pictureInPicture]);
          setPipMode('native');
          return;
        } catch {
          // Keep the same live canvas stream in the in-page floating view.
        }
      }
      await playback;
      setPipMode('inline');
    } catch {
      stopStream();
      target.classList.add(fallbackClassName);
      setPipMode('mini');
    }
  };

  const isActive = mode !== 'off';
  const isInline = mode === 'inline';

  return (
    <>
      <button
        className={className}
        type="button"
        aria-label={isActive ? 'Close picture in picture' : 'Open picture in picture'}
        aria-pressed={isActive}
        title={isActive ? 'Close picture in picture' : 'Open picture in picture'}
        onClick={() => void togglePictureInPicture()}
      >
        {isActive
          ? <Minimize2 size={15} aria-hidden="true" />
          : <PictureInPicture2 size={15} aria-hidden="true" />}
        <span>{isActive ? 'Restore view' : 'PiP'}</span>
      </button>
      <div className={isInline ? `${overlayClassName} ${activeOverlayClassName}` : sourceClassName}>
        <video
          ref={videoRef}
          className={videoClassName}
          muted
          playsInline
          autoPlay
          aria-hidden={!isInline}
          aria-label="Live court picture in picture"
        />
        {isInline && (
          <button
            className={closeClassName}
            type="button"
            aria-label="Close picture in picture"
            onClick={() => void exitPictureInPicture()}
          >
            <Minimize2 size={15} aria-hidden="true" />
          </button>
        )}
      </div>
      {error && <span className={statusClassName} role="status">{error}</span>}
    </>
  );
}
