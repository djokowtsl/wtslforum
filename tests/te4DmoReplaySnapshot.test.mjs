import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
async function loadTs(path, overrides = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports,
    name => overrides[name] ?? require(name));
  return module.exports;
}
const umpireApi = await loadTs('../lib/liveCourtUmpire.ts');
const { te4ViewerToLiveSnapshot } = await loadTs('../lib/te4DmoReplaySnapshot.ts', {
  './liveCourtUmpire': umpireApi,
});

function viewerData() {
  const frameCount = 4;
  const bytes = new Uint8Array(frameCount * 14);
  const view = new DataView(bytes.buffer);
  const frames = [
    [130, 0, 20, -1100, -400, 1100, 400],
    [120, 10, 25, -1090, -400, 1100, 400],
    [110, 20, 30, -1080, -390, 1110, 400],
    [100, 30, 35, -1070, -380, 1120, 410],
  ];
  frames.forEach((values, frame) => {
    values.forEach((value, index) => view.setInt16(frame * 14 + index * 2, value, true));
  });

  return {
    names: ['Replay Player One', 'Replay Player Two'],
    tournament: 'Test Masters',
    surface: 'hard',
    match: {
      n: frameCount,
      fps: 60,
      d: Buffer.from(bytes).toString('base64'),
    },
    pts: [{
      k: 1,
      pt: '15-0',
      s: 1,
      w: 1,
      sh: [{ t: 0, p: 1, k: 's', v: 190, bt: 1 }],
      f: 0,
      g: '1-0',
      tb: 0,
      mf: 0,
      fc: 4,
    }],
    final: {
      ss: [[6, 4]],
      wp: 0.75,
    },
  };
}

test('full TE4 replay court frames and sound events become a live court snapshot', () => {
  const snapshot = te4ViewerToLiveSnapshot(viewerData(), ['left', 'right']);

  assert.equal(snapshot.frameCount, 4);
  assert.equal(snapshot.frameRate, 60);
  assert.deepEqual(snapshot.courtFrameIndices, [0, 2]);
  assert.deepEqual(snapshot.players, ['Replay Player One', 'Replay Player Two']);
  assert.deepEqual(snapshot.handedness, ['left', 'right']);
  assert.equal(snapshot.pointCount, 1);
  assert.equal(snapshot.winChance[0], 0.75);
  assert.deepEqual(
    snapshot.trajectoryEvents.map(({ frame, kind, shotType }) => ({ frame, kind, shotType })),
    [
      { frame: 0, kind: 'shot', shotType: 'serve' },
      { frame: 3, kind: 'point-end', shotType: undefined },
    ],
  );
  assert.equal(
    snapshot.trajectoryEvents.find((event) => event.kind === 'point-end').scoreCall,
    'thirty-love',
    'the point-end call includes the current point winner, not the pre-point score',
  );
  assert.deepEqual(snapshot.soundEvents, [
    { frame: 0, kind: 'racket' },
    { frame: 1, kind: 'bounce' },
  ]);
});

test('full replay conversion rejects oversized encoded court payloads before decoding', () => {
  const invalid = viewerData();
  invalid.match.d = 'A'.repeat(10_000);
  assert.throws(() => te4ViewerToLiveSnapshot(invalid), /court data is incomplete/);
});

test('full replay point ends carry the score-based changeover flag', () => {
  const data = viewerData();
  const base = data.pts[0];
  const point = (k, s, mf, g, pt, w = 1) => ({
    ...base, k, s, w, set: 1, tb: 0, g, pt, mf, fc: 1,
    sh: [{ t: 0, p: s, k: 's', v: 0, bt: null }],
  });
  // Game 1 (server 1): points 1-2; game 2 (server 2): point 3.
  data.match.n = 4;
  data.pts = [
    point(1, 1, 0, '0-0', '0-0'),
    point(2, 1, 1, '0-0', '40-30'),
    point(3, 2, 2, '1-0', '0-0', 2),
  ];
  const snapshot = te4ViewerToLiveSnapshot(data);
  const ends = snapshot.trajectoryEvents.filter((event) => event.kind === 'point-end');
  assert.deepEqual(ends.map((event) => event.changeover), [false, true, false]);
  assert.equal(ends[1].scoreCall, 'Game, Replay Player One');
});

test('replay score calls use the next DMO point state and announce the right game end', () => {
  const data = viewerData();
  const base = data.pts[0];
  data.match.n = 6;
  data.match.d = Buffer.alloc(data.match.n * 14).toString('base64');
  const point = (k, mf, pt, g, winner, server, set = 1, tb = 0) => ({
    ...base,
    k, mf, fc: 1, pt, g, w: winner, s: server, set, tb,
    sh: [{ t: 0, p: server, k: 's', v: 0, bt: null }],
  });
  data.pts = [
    point(1, 0, '0-0', '1-0', 1, 1),
    point(2, 1, '15-0', '1-0', 2, 1),
    point(3, 2, '15-15', '1-0', 1, 1),
    point(4, 3, '30-15', '1-0', 1, 1),
    point(5, 4, '40-15', '1-0', 1, 1),
    point(6, 5, '0-0', '2-0', 2, 2),
  ];

  const snapshot = te4ViewerToLiveSnapshot(data);
  const scoreCalls = snapshot.trajectoryEvents
    .filter((event) => event.kind === 'point-end')
    .map((event) => event.scoreCall);
  assert.deepEqual(scoreCalls, [
    'fifteen-love',
    'fifteen-all',
    'thirty-fifteen',
    'forty-fifteen',
    'Game, Replay Player One',
    'fifteen-love',
  ]);
});

test('replay tiebreak scores stay in player order when service changes', () => {
  const data = viewerData();
  const base = data.pts[0];
  const point = (k, mf, pt, winner, server) => ({
    ...base,
    k, mf, fc: 1, pt, g: '6-6', w: winner, s: server, set: 1, tb: 1,
    sh: [{ t: 0, p: server, k: 's', v: 0, bt: null }],
  });
  data.pts = [
    point(1, 0, '5-5', 1, 1),
    point(2, 1, '6-5', 2, 2),
  ];

  const snapshot = te4ViewerToLiveSnapshot(data);
  const scoreCalls = snapshot.trajectoryEvents
    .filter((event) => event.kind === 'point-end')
    .map((event) => event.scoreCall);
  assert.deepEqual(scoreCalls, ['six-five', 'six-all']);
});
