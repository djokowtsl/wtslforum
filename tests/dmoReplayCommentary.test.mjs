import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { buildDmoPointCommentary } from '../lib/dmoCommentary.mjs';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const source = await readFile(new URL('../lib/dmoReplayCommentary.ts', import.meta.url), 'utf8');
const { code } = transformSync(source, {
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
  module: { type: 'commonjs' },
});
const module = { exports: {} };
new Function('module', 'exports', 'require', code)(module, module.exports, require);
const { buildDmoReplayCommentaryPoints } = module.exports;
const names = ['barboza', 'Debuffy'];
function call(before, after) {
  const point = { k: 1, mf: 0, fc: 30, s: 1, w: 1, n: 2, f: 0, sh: [], tb: 0 };
  const points = buildDmoReplayCommentaryPoints({
    match: { n: 300 },
    pts: [
      { ...point, set: 1, ...before },
      { ...point, k: 2, set: 1, ...after },
    ],
  });
  return buildDmoPointCommentary(points[0], names);
}

test('ordinary viewer point scores do not announce a game or set', () => {
  assert.equal(call({ g: '0-0', pt: '0-0' }, { g: '0-0', pt: '15-0' }), '');
  assert.equal(call({ g: '0-0', pt: '15-0' }, { g: '0-0', pt: '30-0' }), '');
  assert.equal(buildDmoPointCommentary({
    winner: 1, server: 1, rallyHits: 2, scoreBeforeLabel: '15-0', scoreAfterLabel: '30-0',
  }, names), '');
  assert.equal(buildDmoPointCommentary({
    winner: 2, server: 1, scoreBeforeLabel: '15-30(40-15)', scoreAfterLabel: '15-30(40-30)',
  }, names), '');
  assert.equal(buildDmoPointCommentary({
    winner: 2, server: 1, scoreBeforeLabel: '0-0(40-30)', scoreAfterLabel: '15-30(0-0)',
  }, names), '');
});

test('routine game transitions get a short call and break-point conversions remain grounded', () => {
  assert.match(call({ g: '2-3', pt: '40-0' }, { g: '3-3', pt: '0-0' }), /barboza.*game|game.*barboza/i);
  assert.match(call({ g: '2-3', pt: '40-30', s: 2 }, { g: '3-3', pt: '0-0' }), /break/i);
});

test('viewer set resets and tie-break endings announce the correct set winner', () => {
  assert.match(call({ g: '5-4', pt: '40-0' }, { g: '0-0', pt: '0-0', set: 2 }), /barboza takes the set, six-four/);
  assert.match(call({ g: '6-6', pt: '6-5', tb: 1 }, { g: '0-0', pt: '0-0', set: 2 }), /barboza takes the set, seven-six/);
  assert.equal(call({ g: '6-6', pt: '6-5', tb: 1 }, { g: '6-6', pt: '6-6' }), '');
});

test('set announcements require an explicit set-number transition', () => {
  assert.doesNotMatch(
    call({ g: '5-4', pt: '40-0' }, { g: '6-4', pt: '0-0' }),
    /wins the set/,
  );
  assert.equal(
    buildDmoPointCommentary({
      winner: 1, server: 1, scoreBeforeLabel: '5-4(40-0)', scoreAfterLabel: '0-0(0-0)',
      setBefore: 1, setAfter: 2,
    }, names),
    "Oh, that's the set for barboza!",
  );
});

test('inferred final replay points remain silent', () => {
  assert.equal(call({ g: '6-5', pt: '40-0', inferred: true }, { g: '7-5', pt: '0-0' }), '');
});

test('replay points carry set counts and only a verified match end', () => {
  const base = { mf: 0, fc: 30, n: 2, f: 0, sh: [], tb: 0, s: 1 };
  const viewer = {
    match: { n: 900 },
    final: { ss: [[6, 4], [7, 5]], wp: 1 },
    pts: [
      { ...base, k: 1, w: 1, set: 2, ss: [[6, 4]], g: '5-5', pt: '40-0' },
      { ...base, k: 2, w: 1, set: 2, ss: [[6, 4]], g: '6-5', pt: '40-30', mf: 100 },
    ],
  };
  const points = buildDmoReplayCommentaryPoints(viewer, { bestOf: 3 });
  assert.deepEqual(points[0].setsWonBefore, [1, 0]);
  assert.equal(points[0].setsToWin, 2);
  assert.equal(points[0].matchOver, undefined);
  assert.equal(points[1].matchOver, true);
  assert.deepEqual(points[1].finalSets, [[6, 4], [7, 5]]);
  assert.match(buildDmoPointCommentary(points[1], names), /barboza/);

  const abandoned = buildDmoReplayCommentaryPoints({
    ...viewer,
    final: { ss: [[6, 4]], wp: 1 },
    pts: [{ ...base, k: 1, w: 1, set: 1, ss: [], g: '5-4', pt: '40-0' }],
  }, { bestOf: 3 });
  assert.equal(abandoned[0].matchOver, undefined);
});
