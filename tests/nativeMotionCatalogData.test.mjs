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

test('slice slots accept recorded slices on the correct side and retain unnamed-side options for explicit review', () => {
  const backhand = clip('barty-bh-slice', { label: 'Barty-BH-Slice' });
  const forehand = clip('forehand-slice', { label: 'Forehand slice' });
  const neutral = clip('evans-slice1', { label: 'evans-slice1' });
  assert.equal(nativeMotionClipSupportsStroke(backhand, 'slice-backhand'), true);
  assert.equal(nativeMotionClipSupportsStroke(backhand, 'slice-forehand'), false);
  assert.equal(nativeMotionClipSupportsStroke(forehand, 'slice-forehand'), true);
  assert.equal(nativeMotionClipSupportsStroke(forehand, 'slice-backhand'), false);
  assert.equal(nativeMotionClipSupportsStroke(neutral, 'slice-backhand'), true);
  assert.equal(nativeMotionClipSupportsStroke(neutral, 'slice-forehand'), true);
  assert.equal(nativeMotionClipSupportsStroke(clip('ordinary-fh'), 'slice-forehand'), false);
  assert.equal(nativeMotionClipSupportsStroke(clip('broken-bh-slice', {
    events: { kind: 'strike', contactTime: 2 },
  }), 'slice-backhand'), false);
});

test('character slice defaults remain separate from drives and do not guess an unnamed side', () => {
  const catalog = { clips: [
    clip('barty-bh-slice', { label: 'Barty-BH-Slice' }),
    clip('barty-backhand', { label: 'Barty backhand' }),
    clip('barty-fh-slice', { label: 'Barty-FH-Slice' }),
    clip('barty-forehand', { label: 'Barty forehand' }),
    clip('evans-slice1', { label: 'Evans slice1' }),
  ] };
  const defaults = nativeMotionCharacterDefaults(catalog, 'Ashleigh Barty');
  assert.equal(defaults.backhand.id, 'barty-backhand');
  assert.equal(defaults.forehand.id, 'barty-forehand');
  assert.equal(defaults['slice-backhand'].id, 'barty-bh-slice');
  assert.equal(defaults['slice-forehand'].id, 'barty-fh-slice');
  assert.deepEqual(nativeMotionCharacterDefaults(catalog, 'Dan Evans'), {});
  assert.equal(firstValidNativeMotionClip({ clips: [catalog.clips[4]] }, 'slice-forehand'), null);
});

test('match slice overrides replace just their own side and preserve the ordinary stroke', () => {
  const drive = { clipId: 'a1_b1', sourceHandedness: 'right' };
  const slice = { clipId: 'a2_b2', sourceHandedness: 'left' };
  const override = { clipId: 'a3_b3', sourceHandedness: 'right' };
  const picks = mergeNativeMotionPicks(
    { backhand: drive, 'slice-backhand': slice },
    { 'slice-backhand': override },
  );
  assert.deepEqual(picks, { backhand: drive, 'slice-backhand': override });
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
