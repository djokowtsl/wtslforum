import test from 'node:test';
import assert from 'node:assert/strict';
import { groundstrokeCaptureWeight, serveCaptureWeight } from '../components/DmoCapturedGroundstroke.ts';

test('captured groundstroke blends in before contact and fades after follow-through', () => {
  assert.equal(groundstrokeCaptureWeight(-23), 0);
  assert.ok(groundstrokeCaptureWeight(-18) > 0.3);
  assert.ok(groundstrokeCaptureWeight(-8) > 0.6);
  assert.equal(groundstrokeCaptureWeight(0), 1);
  assert.ok(groundstrokeCaptureWeight(12) > 0.8);
  assert.ok(groundstrokeCaptureWeight(17) > 0);
  assert.equal(groundstrokeCaptureWeight(22), 0);
});

test('serve capture covers preparation, contact, and recovery inside the event lookup window', () => {
  assert.equal(serveCaptureWeight(-64), 0);
  assert.ok(serveCaptureWeight(-58) > 0.3);
  assert.ok(serveCaptureWeight(-12) > 0.3);
  assert.equal(serveCaptureWeight(0), 1);
  assert.ok(serveCaptureWeight(12) > 0.8);
  assert.ok(serveCaptureWeight(17) > 0);
  assert.equal(serveCaptureWeight(22), 0);
});
