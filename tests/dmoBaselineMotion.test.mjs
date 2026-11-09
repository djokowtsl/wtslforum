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
  assert.match(update, /nextLiveCourtCarryMode\(Boolean\(rig\.root\.userData\.carryMode\),/);
  assert.match(update, /const strolling = Math\.max\(isBetweenPoints\(events, frame\) \? 1 : 0, rallyOver\)/);
  assert.match(update, /rallyOverWeight\(events, frame, frameRate, shot =>/);
  assert.match(update, /ballPassedReceiverFrame\(samples, shot\.frame, frame, receiverIndex\)/);
  assert.match(update, /sliceTakeBackHold/);
});

test('the gait core stays unchanged while captured locomotion adds recorded legs', async () => {
  const expected = {
    'lib/liveCourtGait.ts': 'f4c79a24a344cabb2d5e9e43cb6399c650403cc97cc362c8fba4ae8f9c9d2a11',
    'components/DmoCapturedLocomotion.ts': '879a58861c98c635b16f4e2d5252a669d1c190e0638ae12a3b6e73550ef667b2',
  };
  for (const [path, fingerprint] of Object.entries(expected)) {
    let source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    if (path === 'lib/liveCourtGait.ts') {
      source = source.replace(/\/\*\* Seconds after an unanswered last shot[\s\S]*?^}\n\n/m, '');
    }
    assert.equal(digest(source), fingerprint, path);
  }
  const motion = await readFile(new URL('../lib/liveCourtMotion.ts', import.meta.url), 'utf8');
  const nativePlayer = await readFile(new URL('../components/DmoNativePlayer.ts', import.meta.url), 'utf8');
  const defaultNativePlayer = await readFile(new URL('../components/DmoNativePlayerClaude.ts', import.meta.url), 'utf8');
  const humanModels = await readFile(new URL('../components/DmoHumanModels.ts', import.meta.url), 'utf8');
  assert.match(motion, /export function liveCourtShotSpin/);
  assert.match(motion, /export function lowReachDrop/);
  assert.match(motion, /export function nextLiveCourtCarryMode/);
  assert.match(nativePlayer, /recordedBackhandFaceRoll\(playback\?\.stroke, oneHandedStroke, playback\?\.slice\)/);
  assert.match(humanModels, /nativePlayerVariant: NativePlayerVariant = 'claude'/);
  assert.match(defaultNativePlayer, /recordedBackhandFaceRoll\(playback\?\.stroke, oneHandedStroke, playback\?\.slice\)/);
  assert.match(defaultNativePlayer, /supportStrokeWeight/);
  assert.match(defaultNativePlayer, /userData\.recordedLegs/);
  assert.match(defaultNativePlayer, /userData\.lookTarget/);
  assert.match(defaultNativePlayer, /userData\.serveBounce/);
});

test('actual stroke-selection block latches normal strokes and only overrides qualifying smashes', () => {
  const start = court.indexOf('        if (capturedEvent?.frame !== strokeEvent.frame');
  const end = court.indexOf('        rig.root.userData.capturedGroundstrokeEvent = capturedEvent;', start);
  assert.ok(start >= 0 && end > start);
  const select = new Function(
    'capturedEvent', 'strokeEvent', 'handedness', 'stroke', 'strokeCue', 'recordedVolley', 'recordedTouch',
    'isCapturedSmashShot',
    'isCapturedVolleyShot', 'fullReplay', 'rig', 'liveCourtShotSpin', 'frameRate', 'soundEventsRef',
    'contactSample', 'samples', 'events', 'sceneDataRef', 'TE4_DMO_FRAMES_PER_SECOND',
    `${court.slice(start, end)}\nreturn capturedEvent;`,
  );
  const choose = (previous, event, stroke, cue, qualifies, hand = 'right', spinSlice = false, fullReplay = spinSlice) => select(
    previous, event, hand, stroke, cue, cue === 'close-net', cue === 'soft-touch', () => qualifies,
    () => false, fullReplay, { detailed: true, root: { userData: { capturedVolleys: true } } },
    () => spinSlice ? 'slice' : null, 60, { current: [] },
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
  const actualSlice = choose(undefined, hit, 'backhand', 'standard', false, 'right', true);
  assert.equal(actualSlice.slice, true);
  assert.equal(actualSlice.spinSlice, true, 'ball-flight slices are tracked separately from swing stand-ins');
  const dropShot = choose(undefined, hit, 'forehand', 'soft-touch', false, 'right', false, true);
  assert.equal(dropShot.slice, true, 'soft touches still use the recorded slice-style swing');
  assert.equal(dropShot.spinSlice, undefined, 'soft touch alone does not halve the lunge');
});
