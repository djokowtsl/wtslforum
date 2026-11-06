import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const [fullscreenButton, liveCourt, fallbackCourt, replayPlayer, liveStream, replayLibrary, styles] =
  await Promise.all([
    source('../components/CourtFullscreenButton.tsx'),
    source('../components/DmoLiveCourt3D.tsx'),
    source('../components/DmoLiveCourt.tsx'),
    source('../components/Te4DmoReplayPlayer.tsx'),
    source('../components/LiveStreamEmbed.tsx'),
    source('../components/DmoReplayLibrary.tsx'),
    source('../components/DmoLiveCourt3D.module.css'),
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
