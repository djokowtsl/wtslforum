import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  clampDmoCameraTarget,
  dmoCameraMaxDistanceInsideBowl,
  dmoCameraFloorLift,
  dmoFullscreenCourtCamera,
  responsiveDmoCourtCameraScale,
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

test('compact court camera pulls back as fullscreen aspect narrows', () => {
  assert.equal(responsiveDmoCourtCameraScale(1280, 720, true), 1);
  assert.equal(responsiveDmoCourtCameraScale(640, 360, true), 1.22);
  assert.equal(responsiveDmoCourtCameraScale(635, 475, false), 1.22);
  assert.ok(responsiveDmoCourtCameraScale(635, 475, true) > 1.22);
  assert.ok(responsiveDmoCourtCameraScale(635, 1131, true) > responsiveDmoCourtCameraScale(635, 475, true));
  assert.ok(responsiveDmoCourtCameraScale(635, 1131, true) <= 2.2);
  assert.equal(responsiveDmoCourtCameraScale(0, 0, true), 1);
});

test('compact fullscreen camera frames the court for both device orientations', () => {
  const portrait = dmoFullscreenCourtCamera(635, 1131, true);
  assert.deepEqual([portrait.x, portrait.y, portrait.z], [5, 28, 0]);
  const landscape = dmoFullscreenCourtCamera(1024, 360, true);
  assert.deepEqual([landscape.x, landscape.y, landscape.z], [0, 28.6, 13]);
  assert.ok(dmoFullscreenCourtCamera(635, 475, true));
  assert.equal(dmoFullscreenCourtCamera(635, 1131, false), null);
  assert.equal(dmoFullscreenCourtCamera(1280, 1800, true), null);
  assert.ok(dmoFullscreenCourtCamera(1024, 576, true));
  assert.equal(dmoFullscreenCourtCamera(0, 900, true), null);
  assert.equal(dmoFullscreenCourtCamera(390, NaN, true), null);
});

test('actual perspective projection keeps all court corners and player margins visible', () => {
  for (const [width, height] of [
    [390, 667], [390, 844], [402, 874], [600, 1200], [360, 1000],
    [667, 390], [844, 390], [1024, 360], [1024, 576],
  ]) {
    for (const maxDistance of [18, 25, 32, 40]) {
      const pose = dmoFullscreenCourtCamera(width, height, true, maxDistance);
      const camera = new PerspectiveCamera(pose.fov, width / height, 0.1, 260);
      camera.position.set(pose.x, pose.y, pose.z);
      camera.lookAt(0, 0.5, 0);
      camera.updateMatrixWorld();
      assert.ok(camera.position.distanceTo(new Vector3(0, 0.5, 0)) <= maxDistance + 1e-9);
      let largestProjectedEdge = 0;
      for (const x of [-13.4, 13.4]) {
        for (const z of [-6.24, 6.24]) {
          const projected = new Vector3(x, 0, z).project(camera);
          assert.ok(Math.abs(projected.x) <= 0.941, `horizontal crop at ${width}x${height}`);
          assert.ok(Math.abs(projected.y) <= 0.941, `vertical crop at ${width}x${height}`);
          assert.ok(projected.z > -1 && projected.z < 1);
          largestProjectedEdge = Math.max(largestProjectedEdge, Math.abs(projected.x), Math.abs(projected.y));
        }
      }
      assert.ok(largestProjectedEdge > 0.93, 'court should use the available screen, not shrink into a strip');
    }
  }
});
