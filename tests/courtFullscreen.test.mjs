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

test('mobile fullscreen keeps the court controls instead of entering video-only fullscreen', () => {
  assert.match(fullscreenButton, /webkitRequestFullscreen/);
  assert.match(fullscreenButton, /fallbackClassName/);
  assert.match(fullscreenButton, /enterFallbackFullscreen/);
  assert.match(fullscreenButton, /activeFullscreenElement\(\) !== target/);
  assert.match(fullscreenButton, /document\.body\.style\.position = 'fixed'/);
  assert.match(fullscreenButton, /relaxClippingAncestors/);
  assert.doesNotMatch(fullscreenButton, /videoRef|webkitEnterFullscreen|webkitbeginfullscreen|webkitendfullscreen/);
  assert.match(styles, /\.scene\.fullscreenFallback/);
  assert.match(fallbackStyles, /\.scene\.fullscreenFallback/);
  assert.doesNotMatch(styles, /\.scene\.fullscreenFallback\s*\{[^}]*min-height:\s*100vh/s);
  assert.doesNotMatch(fallbackStyles, /\.scene\.fullscreenFallback\s*\{[^}]*min-height:\s*100vh/s);
  assert.match(styles, /\.scene:fullscreen \.toolbar,[\s\S]*?position:\s*absolute/);
  assert.doesNotMatch(styles, /\.scene:fullscreen \.toolbar[\s\S]{0,180}display:\s*none/);
  const portraitFullscreenStyles = styles.match(
    /@media \(max-width: 720px\) and \(orientation: portrait\)\s*\{([\s\S]*?)\n\}/,
  )?.[1] ?? '';
  assert.match(portraitFullscreenStyles, /\.scene:fullscreen \.toolbar/);
  assert.match(portraitFullscreenStyles, /\.scene\.fullscreenFallback \.toolbar/);
  assert.match(portraitFullscreenStyles, /max-height:\s*24dvh/);
  assert.match(portraitFullscreenStyles, /overflow-y:\s*auto/);
  assert.match(portraitFullscreenStyles, /flex:\s*0 1 auto/);
  assert.doesNotMatch(portraitFullscreenStyles, /toolbar[^{}]*display:\s*none/);
  const fullscreenProps = (court) => court.match(/<CourtFullscreenButton[\s\S]*?\/>/)?.[0] ?? '';
  for (const court of [liveCourt, fallbackCourt]) {
    assert.match(fullscreenProps(court), /targetRef=\{sceneElementRef\}/);
    assert.match(fullscreenProps(court), /fallbackClassName=\{styles\.fullscreenFallback\}/);
    assert.doesNotMatch(fullscreenProps(court), /videoRef=/);
  }
  assert.match(fullscreenButton, /orientation\.lock\('landscape'\)/);
  assert.match(fullscreenButton, /orientation\?\.unlock/);
  assert.match(liveCourt, /renderer\.setSize\(width, height, false\)/);
  assert.match(liveCourt, /camera\.aspect = width \/ height/);
  assert.match(fallbackCourt, /\? \{ width: bounds\.width, height: bounds\.height \}/);
  assert.match(fallbackCourt, /Math\.max\(canvas\.width \/ 900, canvas\.height \/ 520\)/);
  assert.doesNotMatch(styles, /Rotate your phone for a wider view/);
  assert.doesNotMatch(fallbackStyles, /Rotate your phone for a wider view/);
});

test('court picture-in-picture opens a native system window or reports unsupported browsers', () => {
  assert.match(pictureInPictureButton, /captureStream/);
  assert.match(pictureInPictureButton, /requestPictureInPicture/);
  assert.match(pictureInPictureButton, /isIOSHomeScreenApp/);
  assert.match(pictureInPictureButton, /webkitSupportsPresentationMode/);
  assert.match(pictureInPictureButton, /webkitSetPresentationMode/);
  assert.match(pictureInPictureButton, /waitForVideoFrame/);
  assert.match(pictureInPictureButton, /requestVideoFrameCallback/);
  assert.match(pictureInPictureButton, /frameCount >= 2/);
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
  assert.match(pictureInPictureButton.slice(toggleStart, requestCall), /void video\.play\(\)\.catch/);
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

test('fullscreen fills the available screen and keeps playback controls available', () => {
  assert.match(fullscreenButton, /dispatchEvent\(new Event\('courtfullscreenchange', \{ bubbles: true \}\)\)/);
  assert.match(liveCourt, /addEventListener\('courtfullscreenchange', resize\)/);
  assert.match(liveCourt, /removeEventListener\('courtfullscreenchange', resize\)/);
  assert.match(liveCourt, /observeDmoManualCamera\(controls/);
  assert.doesNotMatch(liveCourt, /controls\.addEventListener\('start', \(\) => \{\s*cameraViewRef\.current = 'custom'/);
  assert.match(styles, /\.scene:fullscreen/);
  assert.match(styles, /\.scene:fullscreen \.viewport/);
  assert.match(styles, /\.scene:fullscreen \.viewport,[\s\S]*?position:\s*absolute/);
  assert.match(styles, /\.scene:fullscreen \.toolbar,[\s\S]*?position:\s*absolute/);
  assert.match(styles, /\.scene:fullscreen \.toolbar,[\s\S]*?max-height:\s*26dvh/);
  assert.match(styles, /\.scene:fullscreen \.replayControls/);
  assert.match(styles, /\.scene:fullscreen \.replayControls,[\s\S]*?position:\s*absolute/);
  assert.match(styles, /\.scene\.fullscreenFallback\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  assert.match(styles, /\.scene\.fullscreenFallback \.viewport\s*\{[^}]*display:\s*flex[^}]*flex:\s*1 1 auto/s);
  assert.match(liveCourt, /dmoFullscreenCourtCamera\(\s*width, height, nativeFullscreen/);
  assert.match(liveCourt, /responsiveDmoCourtCameraScale\(width, height, nativeFullscreen\)/);
  assert.match(liveCourt, /data-full-replay=\{fullReplay \? 'true' : undefined\}/);
  assert.match(liveCourt, /fullReplay && hasCourtData/);
  assert.match(liveCourt, /host\.style\.width = '100%'/);
  assert.match(liveCourt, /host\.style\.height = '100%'/);
  assert.match(liveCourt, /responsiveDmoCourtCameraScale\(width, height, nativeFullscreen\)/);
  assert.match(liveCourt, /responsiveDmoCourtCameraScale\(viewportWidth, viewportHeight, nativeFullscreen\)/);
  assert.match(liveCourt, /dmoFullscreenCourtCamera\(\s*width, height, nativeFullscreen, maxDistanceForTarget/);
  assert.match(liveCourt, /dmoFullscreenCourtCamera\(\s*viewportWidth, viewportHeight, nativeFullscreen,\s*maxDistanceForTarget/);
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
