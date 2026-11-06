import assert from 'node:assert/strict';
import test from 'node:test';
import { dmoCameraFloorLift, MIN_DMO_CAMERA_HEIGHT } from '../lib/dmoCameraConstraints.ts';

test('court camera floor correction prevents panning below the surface', () => {
  assert.equal(dmoCameraFloorLift(4, 1), 0);
  assert.ok(Math.abs(dmoCameraFloorLift(0.2, -0.4) - 0.6) < 1e-12);
  assert.ok(Math.abs(dmoCameraFloorLift(-37, -36.2) - 37.8) < 1e-12);
  assert.ok(-37 + dmoCameraFloorLift(-37, -36.2) >= MIN_DMO_CAMERA_HEIGHT - 1e-9);
  assert.ok(-36.2 + dmoCameraFloorLift(-37, -36.2) >= -1e-9);
});
