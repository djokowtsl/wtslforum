import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampDmoCameraTarget,
  dmoCameraMaxDistanceInsideBowl,
  dmoCameraFloorLift,
  DMO_CAMERA_PAN_LIMIT,
  DMO_CAMERA_VERTICAL_PAN_LIMIT,
  MIN_DMO_CAMERA_HEIGHT,
} from '../lib/dmoCameraConstraints.ts';

test('court camera floor correction prevents panning below the surface', () => {
  assert.equal(dmoCameraFloorLift(4, 1), 0);
  assert.ok(Math.abs(dmoCameraFloorLift(0.2, -0.4) - 0.6) < 1e-12);
  assert.ok(Math.abs(dmoCameraFloorLift(-37, -36.2) - 37.8) < 1e-12);
  assert.ok(-37 + dmoCameraFloorLift(-37, -36.2) >= MIN_DMO_CAMERA_HEIGHT - 1e-9);
  assert.ok(-36.2 + dmoCameraFloorLift(-37, -36.2) >= -1e-9);
});

test('camera panning stays near its selected court or player view', () => {
  const anchor = { x: 3, y: 1, z: -4 };
  assert.deepEqual(clampDmoCameraTarget(
    { x: 100, y: -20, z: -100 },
    anchor,
  ), {
    x: anchor.x + DMO_CAMERA_PAN_LIMIT,
    y: anchor.y - DMO_CAMERA_VERTICAL_PAN_LIMIT,
    z: anchor.z - DMO_CAMERA_PAN_LIMIT,
  });
  assert.deepEqual(clampDmoCameraTarget(
    { x: 4, y: 2, z: -3 },
    anchor,
  ), { x: 4, y: 2, z: -3 });
});

test('camera distance accounts for venue edge, target offset and maximum pan', () => {
  assert.equal(dmoCameraMaxDistanceInsideBowl(
    { x: 0, y: 0.5, z: 0 },
    36,
    4,
    30,
  ), 30);
  assert.ok(Math.abs(dmoCameraMaxDistanceInsideBowl(
    { x: 0, y: 0.5, z: 18 },
    32,
    4,
    30,
  ) - (32 - 18 - Math.SQRT2 * 4)) < 1e-12);
});
