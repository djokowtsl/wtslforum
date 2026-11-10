import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { observeDmoManualCamera, fullscreenCameraView } from '../lib/dmoCameraInteraction.ts';

test('a tap preserves the preset; manual movement marks custom only once', () => {
  const camera = new PerspectiveCamera();
  camera.position.set(18, 22, 0);
  const controls = new OrbitControls(camera, null);
  controls.update();
  let calls = 0;
  const cleanup = observeDmoManualCamera(controls, () => calls++);
  controls.dispatchEvent({ type: 'start' });
  controls.update();
  controls.dispatchEvent({ type: 'end' });
  assert.equal(calls, 0);
  // Programmatic fitting is not a manual edit.
  camera.position.x = 19;
  controls.update();
  assert.equal(calls, 0);
  controls.dispatchEvent({ type: 'start' });
  camera.position.x = 20;
  controls.update();
  camera.position.x = 21;
  controls.update();
  assert.equal(calls, 1);
  controls.dispatchEvent({ type: 'end' });
  cleanup();
  controls.dispatchEvent({ type: 'start' });
  camera.position.x = 22;
  controls.update();
  assert.equal(calls, 1);
});

test('fullscreen entry restores the selected preset after a manual adjustment', () => {
  for (const preset of ['court', 'aerial', 'tv', 'player-one-first']) {
    assert.equal(fullscreenCameraView('custom', preset, false, true), preset);
    assert.equal(fullscreenCameraView('custom', preset, true, true), 'custom');
    assert.equal(fullscreenCameraView('custom', preset, true, false), 'custom');
    assert.equal(fullscreenCameraView(preset, preset, false, true), preset);
  }
});
