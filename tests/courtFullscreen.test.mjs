import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const [
  fullscreenButton,
  pictureInPictureButton,
  liveCourt,
  fallbackCourt,
  replayPlayer,
  liveStream,
  replayLibrary,
  styles,
  fallbackStyles,
] =
  await Promise.all([
    source('../components/CourtFullscreenButton.tsx'),
    source('../components/CourtPictureInPictureButton.tsx'),
    source('../components/DmoLiveCourt3D.tsx'),
    source('../components/DmoLiveCourt.tsx'),
    source('../components/Te4DmoReplayPlayer.tsx'),
    source('../components/LiveStreamEmbed.tsx'),
    source('../components/DmoReplayLibrary.tsx'),
    source('../components/DmoLiveCourt3D.module.css'),
    source('../components/DmoLiveCourt.module.css'),
  ]);

test('live and replay court renderers share an accessible fullscreen control', () => {
  assert.match(liveCourt, /CourtFullscreenButton/);
  assert.match(liveCourt, /ref=\{sceneElementRef\}/);
  assert.match(fallbackCourt, /CourtFullscreenButton/);
  assert.match(fallbackCourt, /ref=\{sceneElementRef\}/);
  assert.match(fullscreenButton, /requestFullscreen/);
  assert.match(fullscreenButton, /exitFullscreen/);
  assert.match(fullscreenButton, /fullscreenchange/);
  assert.match(fullscreenButton, /aria-label=\{isFullscreen \? 'Exit full screen' : 'Watch full screen'\}/);
});

test('mobile fullscreen falls back to a scroll-locked in-page full-screen view', () => {
  assert.match(fullscreenButton, /webkitRequestFullscreen/);
  assert.match(fullscreenButton, /fallbackClassName/);
  assert.match(fullscreenButton, /enterFallbackFullscreen/);
  assert.match(fullscreenButton, /document\.body\.style\.position = 'fixed'/);
  assert.match(styles, /\.scene\.fullscreenFallback/);
  assert.match(fallbackStyles, /\.scene\.fullscreenFallback/);
  assert.match(liveCourt, /fallbackClassName=\{styles\.fullscreenFallback\}/);
  assert.match(fallbackCourt, /fallbackClassName=\{styles\.fullscreenFallback\}/);
});

test('court picture-in-picture prefers the browser API and has a canvas or scene fallback', () => {
  assert.match(pictureInPictureButton, /captureStream/);
  assert.match(pictureInPictureButton, /requestPictureInPicture/);
  assert.match(pictureInPictureButton, /'inline'/);
  assert.match(pictureInPictureButton, /'mini'/);
  assert.match(liveCourt, /CourtPictureInPictureButton/);
  assert.match(fallbackCourt, /CourtPictureInPictureButton/);
  assert.match(styles, /\.pictureInPictureOverlayActive/);
  assert.match(fallbackStyles, /\.pictureInPictureOverlayActive/);
});

test('fullscreen expands the court while keeping playback controls available', () => {
  assert.match(styles, /\.scene:fullscreen/);
  assert.match(styles, /\.scene:fullscreen \.viewport/);
  assert.match(styles, /\.scene:fullscreen \.replayControls/);
  assert.match(liveCourt, /fullReplay && hasCourtData/);
});

test('embedded broadcast and replay players permit native fullscreen', () => {
  assert.match(liveStream, /allowFullScreen/);
  assert.match(replayPlayer, /allowFullScreen/);
  assert.match(replayPlayer, /allow="fullscreen"/);
  assert.match(replayLibrary, /allow="fullscreen"/);
});
