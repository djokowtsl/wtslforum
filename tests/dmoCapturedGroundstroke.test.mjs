import test from 'node:test';
import assert from 'node:assert/strict';
import { groundstrokeCaptureWeight } from '../components/DmoCapturedGroundstroke.ts';

test('captured groundstroke blends in before contact and fades after follow-through', () => {
  assert.equal(groundstrokeCaptureWeight(-14), 0);
  assert.equal(groundstrokeCaptureWeight(-13), 0);
  assert.ok(groundstrokeCaptureWeight(-8) > 0.6);
  assert.equal(groundstrokeCaptureWeight(0), 1);
  assert.equal(groundstrokeCaptureWeight(12), 1);
  assert.ok(groundstrokeCaptureWeight(17) > 0);
  assert.equal(groundstrokeCaptureWeight(21), 0);
  assert.equal(groundstrokeCaptureWeight(24), 0);
});
