import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_RECOVERY_FRAMES,
  GROUNDSTROKE_LEAD_FRAMES,
  groundstrokeCaptureWeight,
  serveCaptureWeight,
} from '../components/DmoCapturedGroundstroke.ts';

test('captured groundstroke blends in before contact and fades after follow-through', () => {
  assert.equal(groundstrokeCaptureWeight(-GROUNDSTROKE_LEAD_FRAMES), 0);
  assert.ok(groundstrokeCaptureWeight(-30) > 0.3);
  assert.equal(groundstrokeCaptureWeight(-20), 1);
  assert.ok(groundstrokeCaptureWeight(-8) > 0.9);
  assert.equal(groundstrokeCaptureWeight(0), 1);
  assert.ok(groundstrokeCaptureWeight(12) > 0.8);
  assert.ok(groundstrokeCaptureWeight(17) > 0);
  assert.ok(groundstrokeCaptureWeight(28) > 0.3);
  assert.equal(groundstrokeCaptureWeight(CAPTURE_RECOVERY_FRAMES), 0);
});

test('serve capture covers preparation, contact, and recovery inside the event lookup window', () => {
  assert.equal(serveCaptureWeight(-64), 0);
  assert.ok(serveCaptureWeight(-58) > 0.3);
  assert.ok(serveCaptureWeight(-12) > 0.3);
  assert.equal(serveCaptureWeight(0), 1);
  assert.ok(serveCaptureWeight(12) > 0.8);
  assert.ok(serveCaptureWeight(17) > 0);
  assert.ok(serveCaptureWeight(28) > 0.3);
  assert.equal(serveCaptureWeight(CAPTURE_RECOVERY_FRAMES), 0);
});

test('captured motion does not dip between preparation, contact, and follow-through', () => {
  for (let delta = -15; delta <= 16; delta += 0.5) {
    assert.equal(groundstrokeCaptureWeight(delta), 1, `groundstroke weight dips at ${delta}`);
  }
  for (let delta = -48; delta <= 16; delta += 0.5) {
    assert.equal(serveCaptureWeight(delta), 1, `serve weight dips at ${delta}`);
  }
});

test('groundstroke preparation blends in gradually rather than snapping near contact', () => {
  let steepest = 0;
  for (let delta = -GROUNDSTROKE_LEAD_FRAMES - 2; delta <= 0; delta += 1) {
    steepest = Math.max(
      steepest,
      groundstrokeCaptureWeight(delta + 1) - groundstrokeCaptureWeight(delta),
    );
  }
  assert.ok(GROUNDSTROKE_LEAD_FRAMES >= 36);
  assert.ok(steepest < 0.1, `blend-in step per frame ${steepest.toFixed(3)}`);
});
