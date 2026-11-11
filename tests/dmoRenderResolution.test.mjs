import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const source = await readFile(new URL('../components/DmoRenderResolution.ts', import.meta.url), 'utf8');
const { code } = transformSync(source, {
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
  module: { type: 'commonjs' },
});
const module = { exports: {} };
new Function('module', 'exports', code)(module, module.exports);

const {
  AUTO_RENDER_RESOLUTIONS,
  createAdaptiveRenderState,
  getInitialBroadcastRenderSetting,
  getBroadcastRenderPixelRatio,
  observeAdaptiveRenderFrame,
} = module.exports;

test('match replays start at 1080p while live broadcasts remain adaptive', () => {
  assert.equal(getInitialBroadcastRenderSetting(true), '1080p');
  assert.equal(getInitialBroadcastRenderSetting(false), 'auto');
});

test('720p offers a lower GPU pixel budget on laptops and high-density phones', () => {
  assert.equal(getBroadcastRenderPixelRatio(1920, 1080, '720p', 2), 2 / 3);
  assert.equal(getBroadcastRenderPixelRatio(390, 219.375, '720p', 3), 3);
  assert.equal(getBroadcastRenderPixelRatio(844, 474.75, '720p', 3), 1280 / 844);
});

test('1080p rendering targets full HD without rendering beyond device pixels', () => {
  assert.equal(getBroadcastRenderPixelRatio(1920, 1080, '1080p', 3), 1);
  const mobileRatio = getBroadcastRenderPixelRatio(844, 474.75, '1080p', 3);
  assert.ok(Math.abs(mobileRatio - (1920 / 844)) < 0.001);
  assert.equal(getBroadcastRenderPixelRatio(1920, 1080, '1080p', 0), 1);
});

test('4K rendering is capped by device density and the selected target', () => {
  assert.equal(getBroadcastRenderPixelRatio(1920, 1080, '4k', 2), 2);
  assert.equal(getBroadcastRenderPixelRatio(1920, 1080, '4k', 1), 1);
  assert.equal(getBroadcastRenderPixelRatio(844, 474.75, '4k', 3), 3);
  assert.equal(
    getBroadcastRenderPixelRatio(390, 844, '4k', 3),
    Math.min(3, 3840 / 390, 2160 / 844),
  );
  assert.equal(
    getBroadcastRenderPixelRatio(2560, 1080, '1080p', 2),
    Math.min(2, 1920 / 2560, 1080 / 1080),
  );
});

test('automatic resolution can drop below 720p after sustained low frame rates', () => {
  const state = createAdaptiveRenderState();
  for (let frame = 0; frame < 36; frame += 1) {
    observeAdaptiveRenderFrame(state, 1000 / 35);
  }
  assert.equal(state.tierIndex, 0, 'one poor sample window does not lower quality');
  for (let frame = 0; frame < 36; frame += 1) {
    observeAdaptiveRenderFrame(state, 1000 / 35);
  }
  assert.equal(state.tierIndex, 1);
  assert.equal(AUTO_RENDER_RESOLUTIONS[state.tierIndex], '720p');
  assert.equal(getBroadcastRenderPixelRatio(1920, 1080, '540p', 2), 0.5);

  for (let frame = 0; frame < 160; frame += 1) {
    observeAdaptiveRenderFrame(state, 1000 / 35);
  }
  assert.equal(state.tierIndex, 3);
  assert.equal(AUTO_RENDER_RESOLUTIONS[state.tierIndex], '360p');
  for (let frame = 0; frame < 400; frame += 1) {
    observeAdaptiveRenderFrame(state, 1000 / 35);
  }
  assert.equal(state.tierIndex, AUTO_RENDER_RESOLUTIONS.length - 1);
});

test('automatic resolution recovers slowly and ignores hidden or long-paused frames', () => {
  const state = createAdaptiveRenderState();
  for (let frame = 0; frame < 80; frame += 1) {
    observeAdaptiveRenderFrame(state, 1000 / 35);
  }
  assert.equal(state.tierIndex, 1);

  observeAdaptiveRenderFrame(state, 1000 / 35, false);
  for (let frame = 0; frame < 60; frame += 1) {
    observeAdaptiveRenderFrame(state, 1000 / 35);
  }
  assert.equal(state.tierIndex, 1, 'a hidden tab resets low-performance evidence');

  observeAdaptiveRenderFrame(state, 1500);
  assert.equal(state.tierIndex, 1, 'a long scheduling pause does not lower quality');

  for (let frame = 0; frame < 500; frame += 1) {
    observeAdaptiveRenderFrame(state, 1000 / 60);
  }
  assert.equal(state.tierIndex, 0, 'quality rises one step only after sustained smooth frames');
});
