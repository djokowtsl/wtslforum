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

const { getBroadcastRenderPixelRatio } = module.exports;

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
