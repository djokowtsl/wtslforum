import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUNDSTROKE_LEAD_FRAMES, groundstrokeCaptureWeight, serveCaptureWeight,
} from '../components/DmoCapturedGroundstroke.ts';

test('captured groundstroke blends in before contact and fades after follow-through', () => {
  assert.equal(groundstrokeCaptureWeight(-GROUNDSTROKE_LEAD_FRAMES - 1), 0);
  assert.ok(groundstrokeCaptureWeight(-30) > 0.3, 'the take-back starts ~0.5 s before contact');
  assert.equal(groundstrokeCaptureWeight(-20), 1);
  assert.ok(groundstrokeCaptureWeight(-8) > 0.6);
  assert.equal(groundstrokeCaptureWeight(0), 1);
  assert.ok(groundstrokeCaptureWeight(12) > 0.8);
  assert.ok(groundstrokeCaptureWeight(17) > 0);
  assert.ok(groundstrokeCaptureWeight(28) > 0.3, 'recovery eases out over ~0.4 s');
  assert.equal(groundstrokeCaptureWeight(40), 0);
});

test('serve capture covers preparation, contact, and recovery inside the event lookup window', () => {
  assert.equal(serveCaptureWeight(-64), 0);
  assert.ok(serveCaptureWeight(-58) > 0.3);
  assert.ok(serveCaptureWeight(-12) > 0.3);
  assert.equal(serveCaptureWeight(0), 1);
  assert.ok(serveCaptureWeight(12) > 0.8);
  assert.ok(serveCaptureWeight(17) > 0);
  assert.ok(serveCaptureWeight(28) > 0.3);
  assert.equal(serveCaptureWeight(40), 0);
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
