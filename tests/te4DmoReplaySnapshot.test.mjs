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
