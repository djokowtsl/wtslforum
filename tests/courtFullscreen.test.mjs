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
  replayScoreBugStyles,
  liveDisplay,
  liveDisplayStyles,
  crowdDensityStyles,
  broadcastViewer,
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
    source('../components/DmoReplayScoreBug.module.css'),
    source('../components/DmoLiveDisplay.tsx'),
    source('../components/DmoLiveDisplay.module.css'),
    source('../components/DmoCrowdDensityControl.module.css'),
    source('../components/DmoLiveViewer.tsx'),
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

test('mobile fullscreen uses native video or an unclipped viewport fallback', () => {
  assert.match(fullscreenButton, /webkitRequestFullscreen/);
  assert.match(fullscreenButton, /webkitEnterFullscreen/);
  assert.match(fullscreenButton, /webkitbeginfullscreen/);
  assert.match(fullscreenButton, /fallbackClassName/);
  assert.match(fullscreenButton, /enterFallbackFullscreen/);
  assert.match(fullscreenButton, /document\.body\.style\.position = 'fixed'/);
  assert.match(fullscreenButton, /relaxClippingAncestors/);
  assert.match(styles, /\.scene\.fullscreenFallback/);
  assert.match(fallbackStyles, /\.scene\.fullscreenFallback/);
  assert.doesNotMatch(styles, /\.scene\.fullscreenFallback\s*\{[^}]*min-height:\s*100vh/s);
  assert.doesNotMatch(fallbackStyles, /\.scene\.fullscreenFallback\s*\{[^}]*min-height:\s*100vh/s);
  assert.match(liveCourt, /fallbackClassName=\{styles\.fullscreenFallback\}/);
  assert.match(fallbackCourt, /fallbackClassName=\{styles\.fullscreenFallback\}/);
  assert.match(fullscreenButton, /orientation\.lock\('landscape'\)/);
  assert.match(fullscreenButton, /orientation\?\.unlock/);
  assert.match(liveCourt, /getFullscreen16By9Size/);
  assert.match(fallbackCourt, /getFullscreen16By9Size/);
  assert.match(styles, /Rotate your phone for a wider view/);
  assert.match(fallbackStyles, /Rotate your phone for a wider view/);
  assert.match(liveCourt, /CourtFullscreenButton[\s\S]*?videoRef=\{mediaVideoRef\}/);
  assert.match(fallbackCourt, /CourtFullscreenButton[\s\S]*?videoRef=\{mediaVideoRef\}/);
});

test('court picture-in-picture opens a native system window or reports unsupported browsers', () => {
  assert.match(pictureInPictureButton, /captureStream/);
  assert.match(pictureInPictureButton, /requestPictureInPicture/);
  assert.match(pictureInPictureButton, /isIOSHomeScreenApp/);
  assert.match(pictureInPictureButton, /webkitSupportsPresentationMode/);
  assert.match(pictureInPictureButton, /webkitSetPresentationMode/);
  assert.match(pictureInPictureButton, /waitForVideoFrame/);
  assert.match(pictureInPictureButton, /video\.controls = true/);
  assert.match(pictureInPictureButton, /setVideoReady\(true\)/);
  assert.match(pictureInPictureButton, /disabled=\{!videoReady\}/);
  assert.match(pictureInPictureButton, /mediaVideoRef/);
  assert.match(pictureInPictureButton, /data-pip-toggle/);
  assert.match(pictureInPictureButton, /This browser cannot open a system Picture in Picture window/);
  const toggleStart = pictureInPictureButton.indexOf('const togglePictureInPicture = () =>');
  const requestCall = pictureInPictureButton.indexOf('video.requestPictureInPicture!()', toggleStart);
  assert.ok(toggleStart >= 0 && requestCall > toggleStart);
  assert.doesNotMatch(pictureInPictureButton.slice(toggleStart, requestCall), /\bawait\b/);
  for (const court of [liveCourt, fallbackCourt]) {
    assert.match(court, /target\.closest\('\[data-sound-toggle\]'\)/);
    assert.match(court, /target\.closest\('\[data-pip-toggle\]'\)/);
  }
  assert.doesNotMatch(pictureInPictureButton, /setPipMode\('(inline|mini)'\)/);
  assert.match(liveCourt, /CourtPictureInPictureButton/);
  assert.match(fallbackCourt, /CourtPictureInPictureButton/);
  assert.match(liveStream, /picture-in-picture/);
  assert.doesNotMatch(styles, /pictureInPictureOverlayActive|pictureInPictureFallback/);
  assert.doesNotMatch(fallbackStyles, /pictureInPictureOverlayActive|pictureInPictureFallback/);
  assert.doesNotMatch(styles, /pictureInPictureSource[\s\S]{0,180}z-index:\s*-1/);
  assert.doesNotMatch(fallbackStyles, /pictureInPictureSource[\s\S]{0,180}z-index:\s*-1/);
});

test('full replay scoreboard renders below the 3D court instead of covering it', () => {
  const courtStart = replayPlayer.indexOf('<DmoLiveCourt3D');
  const courtEnd = replayPlayer.indexOf('/>', courtStart);
  const scoreBug = replayPlayer.indexOf('<DmoReplayScoreBug');
  assert.ok(courtStart >= 0 && courtEnd > courtStart && scoreBug > courtEnd);
  assert.doesNotMatch(replayPlayer, /replayOverlay=/);
  assert.doesNotMatch(replayScoreBugStyles, /position:\s*absolute/);
  assert.match(replayScoreBugStyles, /margin:\s*12px auto/);
});

test('live score table stays below the broadcast scene and crowd control stays in layout', () => {
  const stageStart = liveDisplay.indexOf('<div className={styles.liveCourtStage}>');
  const stageEnd = liveDisplay.indexOf('</div>', stageStart);
  const scoreBug = liveDisplay.indexOf('<aside className={styles.scoreBug}', stageEnd);
  assert.ok(stageStart >= 0 && stageEnd > stageStart && scoreBug > stageEnd);
  assert.match(liveDisplayStyles, /\.scoreBug\s*\{[^}]*position:\s*static/s);
  assert.doesNotMatch(liveDisplayStyles, /\.scoreBug\s*\{[^}]*position:\s*absolute/s);
  assert.match(crowdDensityStyles, /\.courtDensityShell\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(crowdDensityStyles, /\.crowdDensityControl\s*\{[^}]*position:\s*absolute/s);
});

test('saved player stroke setup reaches the full broadcast replay', () => {
  assert.match(broadcastViewer, /strokeStyles=\{broadcast\.snapshot\.strokeStyles\}/);
  assert.match(replayPlayer, /strokeStyles: strokeStyles \?\? initialSnapshot\.strokeStyles/);
});

test('fullscreen expands the court while keeping playback controls available', () => {
  assert.match(styles, /\.scene:fullscreen/);
  assert.match(styles, /\.scene:fullscreen \.viewport/);
  assert.match(styles, /\.scene:fullscreen \.replayControls/);
  assert.match(liveCourt, /fullReplay && hasCourtData/);
  assert.match(liveCourt, /aria-label="Graphics resolution"/);
  assert.match(fallbackCourt, /aria-label="Graphics resolution"/);
  assert.match(liveCourt, /useState<BroadcastRenderQuality>\('1080p'\)/);
});

test('embedded broadcast and replay players permit native fullscreen', () => {
  assert.match(liveStream, /allowFullScreen/);
  assert.match(replayPlayer, /allowFullScreen/);
  assert.match(replayPlayer, /allow="fullscreen"/);
  assert.match(replayLibrary, /allow="fullscreen"/);
});
