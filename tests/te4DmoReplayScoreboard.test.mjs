import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
async function loadTs(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, require);
  return module.exports;
}

const {
  buildTe4DmoReplayScoreTimeline,
  te4DmoReplayScoreAtFrame,
} = await loadTs('../lib/te4DmoReplayScoreboard.ts');

function point(overrides = {}) {
  return {
    k: 1,
    mf: 0,
    fc: 10,
    ss: [],
    sc: 0,
    rs: '',
    wp: 0.5,
    rt: '',
    set: 1,
    g: '0-0',
    pt: '0-0',
    tb: 0,
    s: 1,
    w: 1,
    f: 0,
    n: 1,
    inferred: false,
    sh: [],
    ...overrides,
  };
}

function viewer(points, finalSets = []) {
  return {
    names: ['Player One', 'Player Two'],
    score: '',
    tournament: 'Replay Test',
    surface: 'hard',
    highlights: [],
    sets: finalSets,
    final: { ss: finalSets, wp: 0.5 },
    match: { d: '', n: 100, fps: 60 },
    pts: points,
  };
}

test('scoreboard advances when a point ends and retains the opening score before it', () => {
  const timeline = buildTe4DmoReplayScoreTimeline(viewer([
    point({ mf: 0, fc: 10, pt: '0-0', g: '2-3' }),
    point({ k: 2, mf: 20, pt: '15-0', g: '3-3', s: 2 }),
  ], [[6, 4]]));

  assert.deepEqual(te4DmoReplayScoreAtFrame(timeline, 8), {
    setNumber: 1,
    sets: [],
    games: [2, 3],
    pointText: ['0', '0'],
    tiebreak: false,
    server: 1,
    final: false,
  });
  assert.equal(te4DmoReplayScoreAtFrame(timeline, 9)?.games.join('-'), '3-3');
  assert.deepEqual(te4DmoReplayScoreAtFrame(timeline, 9)?.pointText, ['15', '0']);
});

test('scoreboard recognizes deuce and advantage labels in player order', () => {
  const timeline = buildTe4DmoReplayScoreTimeline(viewer([
    point({ fc: 10, pt: '40-30' }),
    point({ k: 2, mf: 20, pt: 'deuce', s: 2 }),
    point({ k: 3, mf: 30, pt: 'ad 1', s: 1 }),
    point({ k: 4, mf: 40, pt: 'ad 2', s: 2 }),
  ]));

  assert.deepEqual(te4DmoReplayScoreAtFrame(timeline, 9)?.pointText, ['40', '40']);
  assert.deepEqual(te4DmoReplayScoreAtFrame(timeline, 29)?.pointText, ['AD', '40']);
  assert.deepEqual(te4DmoReplayScoreAtFrame(timeline, 39)?.pointText, ['40', 'AD']);
});

test('set transitions show completed sets and the new current set', () => {
  const timeline = buildTe4DmoReplayScoreTimeline(viewer([
    point({ fc: 10, set: 1, g: '6-6', pt: '6-5', tb: 1 }),
    point({ k: 2, mf: 20, set: 2, ss: [[7, 6]], g: '0-0', pt: '0-0' }),
  ], [[7, 6], [6, 4]]));
  const score = te4DmoReplayScoreAtFrame(timeline, 9);

  assert.equal(score?.setNumber, 2);
  assert.deepEqual(score?.sets, [[7, 6]]);
  assert.deepEqual(score?.games, [0, 0]);
});

test('tiebreak scoreboard remains in player order independently of server', () => {
  const timeline = buildTe4DmoReplayScoreTimeline(viewer([
    point({ tb: 1, pt: '6-7', s: 2, g: '6-6' }),
  ]));
  const score = te4DmoReplayScoreAtFrame(timeline, 0);

  assert.deepEqual(score?.pointText, ['6', '7']);
  assert.equal(score?.server, 2);
  assert.equal(score?.tiebreak, true);
});

test('the last point shows the completed match score', () => {
  const timeline = buildTe4DmoReplayScoreTimeline(viewer([
    point({ mf: 10, fc: 10, set: 3, ss: [[6, 4], [4, 6]], g: '6-5', pt: '40-30' }),
  ], [[6, 4], [4, 6], [7, 5]]));
  const score = te4DmoReplayScoreAtFrame(timeline, 19);

  assert.equal(score?.final, true);
  assert.deepEqual(score?.sets, [[6, 4], [4, 6], [7, 5]]);
  assert.deepEqual(score?.games, [7, 5]);
  assert.deepEqual(score?.pointText, ['—', '—']);
});
