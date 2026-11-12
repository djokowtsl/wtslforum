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
    match: { n: 300 }, pts: [{ ...point, ...before }, { ...point, k: 2, ...after }],
  });
  return buildDmoPointCommentary(points[0], names);
}

test('ordinary viewer point scores do not announce a game or set', () => {
  assert.equal(call({ g: '0-0', pt: '0-0' }, { g: '0-0', pt: '15-0' }), '');
  assert.equal(call({ g: '0-0', pt: '15-0' }, { g: '0-0', pt: '30-0' }), '');
  assert.equal(buildDmoPointCommentary({
    winner: 1, server: 1, rallyHits: 2, scoreBeforeLabel: '15-0', scoreAfterLabel: '30-0',
  }, names), '');
});

test('viewer game endings announce real game scores, never point values', () => {
  assert.match(call({ g: '2-3', pt: '40-0' }, { g: '3-3', pt: '0-0' }),
    /A hold for barboza; the games now stand three games to three/);
  assert.match(call({ g: '2-3', pt: '40-0', s: 2 }, { g: '3-3', pt: '0-0' }),
    /A break for barboza/);
});

test('viewer set resets and tie-break endings announce the correct set winner', () => {
  assert.match(call({ g: '5-4', pt: '40-0' }, { g: '0-0', pt: '0-0' }), /wins the set for barboza/);
  assert.match(call({ g: '6-6', pt: '6-5', tb: 1 }, { g: '0-0', pt: '0-0' }), /wins the set for barboza/);
  assert.equal(call({ g: '6-6', pt: '6-5', tb: 1 }, { g: '6-6', pt: '6-6' }), '');
});

test('inferred final replay points remain silent', () => {
  assert.equal(call({ g: '6-5', pt: '40-0', inferred: true }, { g: '7-5', pt: '0-0' }), '');
});
