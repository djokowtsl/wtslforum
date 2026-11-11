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
const {
  deduplicateNativeMotionCharacterNames,
  firstValidNativeMotionClip,
  nativeMotionClipSupportsStroke,
  nativeMotionProfileKey,
  mergeNativeMotionPicks,
  nativeMotionCharacterDefaults,
} = module.exports;

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

test('character profiles are shared by normalized character names, not player accounts', () => {
  assert.equal(nativeMotionProfileKey(' Federer  '), 'federer');
  assert.equal(nativeMotionProfileKey('DJOKOVIC'), 'djokovic');
  assert.deepEqual(
    deduplicateNativeMotionCharacterNames(['Federer', ' federer  ', 'Djokovic', '', null]),
    ['Djokovic', 'Federer'],
  );
});

test('a match overrides only the chosen stroke with exactly one fixed version', () => {
  const defaultForehand = { clipId: 'a1_b1', sourceHandedness: 'right' };
  const defaultServe = { clipId: 'a2_b2', sourceHandedness: 'right' };
  const chosenForehand = { clipId: 'a3_b3', sourceHandedness: 'left' };
  const picks = mergeNativeMotionPicks(
    { forehand: defaultForehand, serve: defaultServe },
    { forehand: chosenForehand },
  );
  assert.equal(picks.forehand, chosenForehand);
  assert.equal(picks.serve, defaultServe);
  assert.equal(Array.isArray(picks.forehand), false);
  assert.deepEqual(mergeNativeMotionPicks({}, {}), {});
});

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

test('automatic fallback skips hidden and acceleration variants but accepts regular linked clips', () => {
  const usableStrike = clip('usable-strike');
  const usableServe = clip('usable-serve', { events: { kind: 'serve', contactTime: 0.5 } });
  const catalog = {
    format: 'WTMC1',
    rig: {},
    clips: [
      clip('hidden-strike', { hidden: true }),
      clip('linked-regular-strike', { acceleration: 'fast' }),
      clip('variant-strike', { accelerationVariant: true }),
      clip('unsupported-strike', { events: { kind: 'strike' } }),
      clip('waiting-serve', { events: { kind: 'serve-waiting', contactTime: 0.5 } }),
      usableStrike,
      usableServe,
    ],
  };
  assert.equal(firstValidNativeMotionClip(catalog, 'forehand'), catalog.clips[1]);
  assert.equal(firstValidNativeMotionClip(catalog, 'backhand'), catalog.clips[1]);
  assert.equal(firstValidNativeMotionClip(catalog, 'serve'), usableServe);
});

test('character defaults choose named regular clips and exclude acceleration variants', () => {
  const catalog = {
    format: 'WTMC1',
    rig: {},
    clips: [
      clip('federer-forehand-acc', {
        sourceBundle: 'federer',
        originalClipName: 'Federer forehand acc',
        label: 'Federer forehand acc',
        accelerationVariant: true,
      }),
      clip('federer-forehand-reg', {
        sourceBundle: 'federer',
        originalClipName: 'Federer forehand reg',
        label: 'Federer forehand reg',
        acceleration: 'Federer forehand acc',
      }),
      clip('federer-backhand', {
        sourceBundle: 'federer',
        originalClipName: 'Federer backhand',
        label: 'Federer backhand',
      }),
      clip('federer-serve', {
        sourceBundle: 'federer',
        originalClipName: 'Federer serve',
        label: 'Federer serve',
        events: { kind: 'serve', contactTime: 0.5 },
      }),
      clip('djokovic-forehand', {
        sourceBundle: 'djokovic',
        originalClipName: 'Djokovic forehand',
        label: 'Djokovic forehand',
      }),
    ],
  };

  const federer = nativeMotionCharacterDefaults(catalog, 'Roger Federer');
  assert.equal(federer.forehand.id, 'federer-forehand-reg');
  assert.equal(federer.backhand.id, 'federer-backhand');
  assert.equal(federer.serve.id, 'federer-serve');
  assert.equal(nativeMotionCharacterDefaults(catalog, 'Novak Djokovic').forehand.id, 'djokovic-forehand');
  assert.deepEqual(nativeMotionCharacterDefaults(catalog, 'Unknown Player'), {});
});
