import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const source = await readFile(new URL('../lib/nativeMotionCatalogData.ts', import.meta.url), 'utf8');
const { code } = transformSync(source, {
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
  module: { type: 'commonjs' },
});
const module = { exports: {} };
new Function('module', 'exports', 'require', code)(module, module.exports, require);
const { firstValidNativeMotionClip, nativeMotionClipSupportsStroke } = module.exports;

function clip(id, overrides = {}) {
  return {
    id,
    file: `${id}.wtm`,
    label: id,
    sourceBundle: 'test-bundle',
    originalClipName: id,
    author: 'test',
    frameCount: 30,
    duration: 1,
    hidden: false,
    acceleration: '',
    accelerationVariant: false,
    sourceHandedness: null,
    events: { kind: 'strike', contactTime: 0.5 },
    ...overrides,
  };
}

test('a usable stroke clip needs the matching SDK contact marker in range', () => {
  assert.equal(nativeMotionClipSupportsStroke(clip('strike'), 'forehand'), true);
  assert.equal(nativeMotionClipSupportsStroke(clip('serve', {
    events: { kind: 'serve', contactTime: 1 },
  }), 'serve'), true);
  assert.equal(nativeMotionClipSupportsStroke(clip('wrong-kind', {
    events: { kind: 'serve', contactTime: 0.5 },
  }), 'forehand'), false);
  assert.equal(nativeMotionClipSupportsStroke(clip('missing', {
    events: { kind: 'strike' },
  }), 'backhand'), false);
  assert.equal(nativeMotionClipSupportsStroke(clip('out-of-range', {
    events: { kind: 'strike', contactTime: 1.1 },
  }), 'forehand'), false);
});

test('automatic fallback skips hidden, acceleration, and unsupported clips', () => {
  const usableStrike = clip('usable-strike');
  const usableServe = clip('usable-serve', { events: { kind: 'serve', contactTime: 0.5 } });
  const catalog = {
    format: 'WTMC1',
    rig: {},
    clips: [
      clip('hidden-strike', { hidden: true }),
      clip('accelerated-strike', { acceleration: 'fast' }),
      clip('variant-strike', { accelerationVariant: true }),
      clip('unsupported-strike', { events: { kind: 'strike' } }),
      clip('waiting-serve', { events: { kind: 'serve-waiting', contactTime: 0.5 } }),
      usableStrike,
      usableServe,
    ],
  };
  assert.equal(firstValidNativeMotionClip(catalog, 'forehand'), usableStrike);
  assert.equal(firstValidNativeMotionClip(catalog, 'backhand'), usableStrike);
  assert.equal(firstValidNativeMotionClip(catalog, 'serve'), usableServe);
});
