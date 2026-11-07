'use client';

import { useEffect, useRef, useState } from 'react';
import { Minimize2, PictureInPicture2 } from 'lucide-react';

type ElementRef<T extends HTMLElement> = { current: T | null };
type PipMode = 'off' | 'native';
type PipVideo = HTMLVideoElement & {
  requestPictureInPicture?: () => Promise<unknown>;
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
  className: string;
  statusClassName: string;
  videoClassName: string;
};

function waitForVideoFrame(video: PipVideo) {
  if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      video.removeEventListener('loadeddata', check);
      video.removeEventListener('playing', check);
      video.removeEventListener('resize', check);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) finish();
    };
    const timeout = window.setTimeout(
      () => finish(new Error('The court video did not produce a frame.')),
      3000,
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
  className,
  statusClassName,
  videoClassName,
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
    stopStream();
  };

  useEffect(() => {
    const video = videoRef.current;
    const onEnterPictureInPicture = () => setPipMode('native');
    const onLeavePictureInPicture = () => {
      stopStream();
      setPipMode('off');
    };
    const onWebkitPresentationModeChange = () => {
      if (video?.webkitPresentationMode === 'picture-in-picture') {
        setPipMode('native');
      } else if (modeRef.current === 'native') {
        stopStream();
        setPipMode('off');
      }
    };
    video?.addEventListener('enterpictureinpicture', onEnterPictureInPicture);
    video?.addEventListener('leavepictureinpicture', onLeavePictureInPicture);
    video?.addEventListener('webkitpresentationmodechanged', onWebkitPresentationModeChange);
    return () => {
      video?.removeEventListener('enterpictureinpicture', onEnterPictureInPicture);
      video?.removeEventListener('leavepictureinpicture', onLeavePictureInPicture);
      video?.removeEventListener('webkitpresentationmodechanged', onWebkitPresentationModeChange);
      if (video?.webkitPresentationMode === 'picture-in-picture') {
        video.webkitSetPresentationMode?.('inline');
      }
      stopStream();
    };
    // This effect owns listeners for the video element created by this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePictureInPicture = async () => {
    if (modeRef.current !== 'off') {
      await exitPictureInPicture();
      return;
    }
    setError('');
    const canvas = canvasRef.current as (HTMLCanvasElement & {
      captureStream?: (frameRate?: number) => MediaStream;
    }) | null;
    const video = videoRef.current;
    if (!canvas || !video || typeof canvas.captureStream !== 'function') {
      setError('System Picture in Picture is unavailable for this court view.');
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
      const stream = canvas.captureStream(30);
      if (!stream.getVideoTracks().length) {
        stream.getTracks().forEach(track => track.stop());
        throw new Error('The court canvas did not provide a video track.');
      }
      streamRef.current = stream;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      const playback = video.play();
      if (supportsWebkitPip) {
        try {
          const pictureInPicture = requestWebkitPictureInPicture(video);
          await Promise.all([playback, pictureInPicture]);
        } catch (webkitError) {
          if (!supportsStandardPip) throw webkitError;
          await playback;
          await waitForVideoFrame(video);
          await video.requestPictureInPicture!();
        }
      } else {
        try {
          const pictureInPicture = video.requestPictureInPicture!();
          await Promise.all([playback, pictureInPicture]);
        } catch {
          await playback;
          await waitForVideoFrame(video);
          await video.requestPictureInPicture!();
        }
      }
      setError('');
      setPipMode('native');
    } catch (error) {
      stopStream();
      setPipMode('off');
      setError(error instanceof Error
        ? `${error.message} Try again after the court has finished loading.`
        : 'System Picture in Picture could not start. Check your browser permissions and try again.');
    }
  };

  const isActive = mode !== 'off';

  return (
    <>
      <button
        className={className}
        type="button"
        aria-label={isActive ? 'Close system picture in picture' : 'Open system picture in picture'}
        aria-pressed={isActive}
        title={isActive ? 'Close system picture in picture' : 'Open system picture in picture'}
        onClick={() => void togglePictureInPicture()}
      >
        {isActive
          ? <Minimize2 size={15} aria-hidden="true" />
          : <PictureInPicture2 size={15} aria-hidden="true" />}
        <span>{isActive ? 'PiP on' : 'PiP'}</span>
      </button>
      <video
        ref={videoRef}
        className={videoClassName}
        muted
        playsInline
        autoPlay
        aria-hidden="true"
      />
      {error && <span className={statusClassName} role="status">{error}</span>}
    </>
  );
}
