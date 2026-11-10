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

const { getBroadcastRenderPixelRatio, getFullscreen16By9Size } = module.exports;

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
});

test('fullscreen frames remain 16:9 in portrait and landscape', () => {
  for (const [width, height] of [[390, 844], [844, 390], [1920, 1080]]) {
    const frame = getFullscreen16By9Size(width, height);
    assert.ok(frame.width <= width);
    assert.ok(frame.height <= height);
    assert.ok(Math.abs(frame.width / frame.height - 16 / 9) < 0.0001);
  }
});
