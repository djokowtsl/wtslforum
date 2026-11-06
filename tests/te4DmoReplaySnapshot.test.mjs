import assert from 'node:assert/strict';
import test from 'node:test';
import { te4ViewerToLiveSnapshot } from '../lib/te4DmoReplaySnapshot.ts';

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
      set: 1,
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
    snapshot.trajectoryEvents.map(({ frame, kind, shotType, changeover }) => ({
      frame, kind, shotType, ...(kind === 'point-end' ? { changeover } : {}),
    })),
    [
      { frame: 0, kind: 'shot', shotType: 'serve' },
      { frame: 3, kind: 'point-end', shotType: undefined, changeover: false },
    ],
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

test('full replay point ends are labelled from odd-game and odd-set score changes', async () => {
  const { changeoversAfterPoints } = await import('../lib/te4DmoReplaySnapshot.ts');
  const points = [];
  let server = 1;
  const addGame = (set, gameScore = '0-0', pointCount = 4) => {
    for (let point = 0; point < pointCount; point += 1) {
      points.push({ s: server, set, tb: 0, g: gameScore });
    }
    server = server === 1 ? 2 : 1;
  };
  for (let game = 0; game < 10; game += 1) {
    addGame(1);
  }
  addGame(2);
  addGame(2);
  const flags = changeoversAfterPoints(points);
  const lastPointOfGame = game => game * 4 - 1;
  assert.equal(flags[lastPointOfGame(1)], true);
  assert.equal(flags[lastPointOfGame(2)], false);
  assert.equal(flags[lastPointOfGame(3)], true);
  assert.equal(flags[lastPointOfGame(10)], false, 'a 6-4 set break does not change ends');
  assert.equal(flags[lastPointOfGame(11)], true, 'the first odd game of the next set does');
});

test('tie-break changeovers occur after six points, not after each server switch', async () => {
  const { changeoversAfterPoints } = await import('../lib/te4DmoReplaySnapshot.ts');
  const points = [];
  let server = 1;
  for (let game = 0; game < 12; game += 1) {
    for (let point = 0; point < 4; point += 1) {
      points.push({ s: server, set: 1, tb: 0, g: '0-0' });
    }
    server = server === 1 ? 2 : 1;
  }
  for (let point = 0; point < 13; point += 1) {
    points.push({
      s: point === 0 || Math.floor((point - 1) / 2) % 2 === 1 ? 1 : 2,
      set: 1,
      tb: 1,
      g: '6-6',
    });
  }
  points.push({ s: 2, set: 2, tb: 0, g: '0-0' });
  const flags = changeoversAfterPoints(points);
  assert.equal(flags[47], false, 'the 6-6 set score alone is not a changeover');
  assert.deepEqual(
    flags.slice(48, 60).flatMap((flag, index) => flag ? [index + 1] : []),
    [6, 12],
  );
  assert.equal(flags[60], true, 'a 7-6 set has an odd game total');
});
