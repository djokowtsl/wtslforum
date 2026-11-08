import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUNDSTROKE_LEAD_FRAMES, GROUNDSTROKE_MIN_LEAD_FRAMES, SERVE_LEAD_FRAMES,
  groundstrokeCaptureWeight, groundstrokeLeadFrames,
  recordedBackhandFaceRoll, recordedStrokeForSide, recordedStrokeUsesTwoHands,
  serveCaptureWeight, SLICE_TIME_SCALE,
} from '../components/DmoCapturedGroundstroke.ts';

test('qualified volleys select the matching side without replacing groundstrokes', () => {
  assert.equal(recordedStrokeForSide('forehand', true), 'volley-forehand');
  assert.equal(recordedStrokeForSide('backhand', true), 'volley-backhand');
  assert.equal(recordedStrokeForSide('forehand', false), 'forehand');
  assert.equal(recordedStrokeForSide('backhand', false), 'backhand');
});

test('slice playback uses the open volley-face roll and three-quarter speed', () => {
  assert.equal(SLICE_TIME_SCALE, 0.75);
  assert.equal(recordedBackhandFaceRoll('backhand', false, true), 35 * Math.PI / 180);
  assert.equal(recordedBackhandFaceRoll('backhand', false), 0);
});

test('captured groundstroke blends in before contact and fades after follow-through', () => {
  assert.equal(groundstrokeCaptureWeight(-GROUNDSTROKE_LEAD_FRAMES - 1), 0);
  assert.ok(groundstrokeCaptureWeight(-30) > 0.3, 'the take-back starts ~0.5 s before contact');
  assert.equal(groundstrokeCaptureWeight(-20), 1);
  assert.ok(groundstrokeCaptureWeight(-8) > 0.6);
  assert.equal(groundstrokeCaptureWeight(0), 1);
  assert.ok(groundstrokeCaptureWeight(12) > 0.8);
  assert.ok(groundstrokeCaptureWeight(17) > 0);
  assert.equal(groundstrokeCaptureWeight(28), 1);
  assert.equal(groundstrokeCaptureWeight(34), 1);
  assert.ok(groundstrokeCaptureWeight(43) > 0.3 && groundstrokeCaptureWeight(43) < 0.7);
  assert.equal(groundstrokeCaptureWeight(52), 0);
});

test('serve capture covers preparation, contact, and recovery inside the event lookup window', () => {
  assert.equal(serveCaptureWeight(-SERVE_LEAD_FRAMES), 0);
  assert.ok(serveCaptureWeight(-95) > 0.3, 'the serve set-up is already playing ~1.6 s before contact');
  assert.ok(serveCaptureWeight(-12) > 0.3);
  assert.equal(serveCaptureWeight(0), 1);
  assert.ok(serveCaptureWeight(12) > 0.8);
  assert.ok(serveCaptureWeight(17) > 0);
  assert.equal(serveCaptureWeight(28), 1);
  assert.ok(serveCaptureWeight(43) > 0.3 && serveCaptureWeight(43) < 0.7);
  assert.equal(serveCaptureWeight(52), 0);
});

test('captured motion never dips between preparation and follow-through (no mid-swing wobble)', () => {
  for (let delta = -15; delta <= 16; delta += 0.5) {
    assert.equal(groundstrokeCaptureWeight(delta), 1, `groundstroke weight dips at ${delta}`);
  }
  for (let delta = -48; delta <= 16; delta += 0.5) {
    assert.equal(serveCaptureWeight(delta), 1, `serve weight dips at ${delta}`);
  }
});

test('the recorded take-back blends in gradually, not in a few frames', () => {
  let steepest = 0;
  for (let delta = -GROUNDSTROKE_LEAD_FRAMES - 2; delta <= 0; delta += 1) {
    steepest = Math.max(steepest, groundstrokeCaptureWeight(delta + 1) - groundstrokeCaptureWeight(delta));
  }
  assert.ok(GROUNDSTROKE_LEAD_FRAMES >= 36, 'starts at least 0.6 s before contact');
  assert.ok(steepest < 0.1, `blend-in step per frame ${steepest.toFixed(3)} (was ~0.21)`);
});

test('the take-back waits until the player has read the opponent’s shot', () => {
  assert.equal(groundstrokeLeadFrames(undefined), GROUNDSTROKE_LEAD_FRAMES);
  assert.equal(groundstrokeLeadFrames(120), GROUNDSTROKE_LEAD_FRAMES);
  assert.equal(groundstrokeLeadFrames(54), 30);
  assert.equal(groundstrokeLeadFrames(30), GROUNDSTROKE_MIN_LEAD_FRAMES);

  let steepest = 0;
  for (let delta = -30; delta <= 0; delta += 1) {
    steepest = Math.max(
      steepest,
      groundstrokeCaptureWeight(delta + 1, 24) - groundstrokeCaptureWeight(delta, 24),
    );
  }
  assert.ok(steepest < 0.1, `step ${steepest.toFixed(3)}`);
});

test('a recorded serve stays one-handed through recovery', () => {
  const twoHandedStyle = { forehand: 'two', backhand: 'two' };
  assert.equal(recordedStrokeUsesTwoHands('serve', twoHandedStyle, true), false);
  assert.equal(recordedStrokeUsesTwoHands('volley-forehand', twoHandedStyle, true), false);
  assert.equal(recordedStrokeUsesTwoHands('volley-backhand', twoHandedStyle, true), false);
  assert.equal(recordedStrokeUsesTwoHands('backhand', twoHandedStyle, false), true);
  assert.equal(recordedStrokeUsesTwoHands(undefined, twoHandedStyle, true), true);
});

test('the recorded serve blends in over half a second, not a quarter', () => {
  let steepest = 0;
  for (let delta = -SERVE_LEAD_FRAMES - 2; delta <= 0; delta += 1) {
    steepest = Math.max(steepest, serveCaptureWeight(delta + 1) - serveCaptureWeight(delta));
  }
  assert.ok(SERVE_LEAD_FRAMES >= 100);
  assert.ok(steepest < 0.06, `blend-in step per frame ${steepest.toFixed(3)} (was ~0.09)`);
});
