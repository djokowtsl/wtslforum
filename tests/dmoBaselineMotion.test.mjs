import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const court = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
const digest = (text) => createHash('sha256').update(text).digest('hex');

// These fingerprints come from the accepted PR 329 player update and motion
// modules. Strip only the explicitly isolated smash override, not whitespace or
// other logic: facing, preparation, recovery and gait must remain byte-identical.
test('ordinary player update includes the calibrated Round 18 motion repairs', () => {
  const start = court.indexOf('    const updatePlayer = (');
  const end = court.indexOf('    const animate = (now: number) => {', start);
  assert.ok(start >= 0 && end > start);
  const update = court.slice(start, end);
  assert.match(update, /const frameScale = liveCourtReplayFrameScale\(frameRate\)/);
  assert.match(update, /liveCourtShotSpin\(samples, strokeEvent\.frame, frameRate\) === 'slice'/);
  assert.match(update, /lowReachDrop\(ballY, Math\.hypot\(localX, localZ\)\)/);
  assert.match(court, /const RALLY_RUN_CARRY_CUTOFF_FRAMES = 36/);
  assert.match(update, /MathUtils\.smoothstep\(carrySpeed, 2\.2, 3\.2\)/);
  assert.match(update, /const strolling = isBetweenPoints\(events, frame\)\s*\? 1 - Math\.max\(serveGate, returnGate\)/);
  assert.match(update, /sliceTakeBackHold/);
});

test('unaffected gait modules retain their accepted baseline and new motion helpers are present', async () => {
  const expected = {
    'lib/liveCourtGait.ts': 'f4c79a24a344cabb2d5e9e43cb6399c650403cc97cc362c8fba4ae8f9c9d2a11',
    'components/DmoCapturedLocomotion.ts': '0d11c9d0b726658bee8e223854a8840af917b04a1ff6e05414af03f7cbbb2d78',
  };
  for (const [path, fingerprint] of Object.entries(expected)) {
    assert.equal(digest(await readFile(new URL(`../${path}`, import.meta.url))), fingerprint, path);
  }
  const motion = await readFile(new URL('../lib/liveCourtMotion.ts', import.meta.url), 'utf8');
  const nativePlayer = await readFile(new URL('../components/DmoNativePlayer.ts', import.meta.url), 'utf8');
  assert.match(motion, /export function liveCourtShotSpin/);
  assert.match(motion, /export function lowReachDrop/);
  assert.match(nativePlayer, /recordedBackhandFaceRoll\(playback\?\.stroke, oneHandedStroke, playback\?\.slice\)/);
});

test('actual stroke-selection block latches normal strokes and only overrides qualifying smashes', () => {
  const start = court.indexOf('        if (capturedEvent?.frame !== strokeEvent.frame');
  const end = court.indexOf('        rig.root.userData.capturedGroundstrokeEvent = capturedEvent;', start);
  assert.ok(start >= 0 && end > start);
  const select = new Function(
    'capturedEvent', 'strokeEvent', 'handedness', 'stroke', 'strokeCue', 'isCapturedSmashShot',
    'isCapturedVolleyShot', 'fullReplay', 'rig', 'liveCourtShotSpin', 'frameRate', 'soundEventsRef',
    'contactSample', 'samples', 'events', 'sceneDataRef', 'TE4_DMO_FRAMES_PER_SECOND',
    `${court.slice(start, end)}\nreturn capturedEvent;`,
  );
  const choose = (previous, event, stroke, cue, qualifies, hand = 'right', slice = false) => select(
    previous, event, hand, stroke, cue, () => qualifies,
    () => false, slice, { detailed: true }, () => slice ? 'slice' : null, 60, { current: [] },
    [], [], [], { current: { snapshot: { frameRate: 60 } } }, 60,
  );
  const hit = { frame: 100, shotType: 'rally' };
  const normal = choose(undefined, hit, 'forehand', 'standard', false);
  assert.equal(normal.stroke, 'forehand');
  assert.equal(choose(normal, hit, 'backhand', 'standard', false), normal,
    'changing ball side or facing cannot reselect an already latched stroke');
  assert.equal(choose(normal, hit, 'volley-backhand', 'close-net', true), normal,
    'late overhead evidence cannot interrupt the original stroke');
  assert.equal(choose(undefined, hit, 'volley-forehand', 'close-net', false).stroke, 'volley-forehand');
  assert.equal(choose(undefined, hit, 'volley-backhand', 'close-net', true).stroke, 'smash');
  assert.equal(choose(undefined, hit, 'forehand', 'standard', true).stroke, 'forehand');
  assert.equal(choose(undefined, { ...hit, shotType: 'serve' }, 'forehand', 'close-net', true).stroke, 'serve');
  assert.equal(choose(normal, { ...hit, frame: 150 }, 'backhand', 'standard', false).stroke, 'backhand');
  assert.equal(choose(normal, hit, 'backhand', 'standard', false, 'left').handedness, 'left');
  assert.equal(choose(undefined, hit, 'backhand', 'standard', false, 'right', true).slice, true);
});
