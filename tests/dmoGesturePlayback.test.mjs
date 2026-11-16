import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDmoPointGestureEvents,
  resolveDmoGesturePlayback,
} from '../lib/dmoGesturePlayback.mjs';

test('ordinary points stay quiet and long rallies produce a winner reaction', () => {
  assert.deepEqual(buildDmoPointGestureEvents([
    { frame: 20, winner: 1, rallyHits: 4 },
    { frame: 80, winner: 2, rallyHits: 12 },
  ]), [{ frame: 80, player: 2, type: 'CheerFist', style: null }]);
});

test('set and match endings produce rare milestone gestures with character styles', () => {
  const events = buildDmoPointGestureEvents([
    { frame: 20, winner: 1, rallyHits: 3, setNumber: 1 },
    { frame: 80, winner: 2, rallyHits: 2, setNumber: 2 },
  ], { characters: ['Novak Djokovic', 'Roger Federer'], matchOver: true });
  assert.deepEqual(events, [
    { frame: 80, player: 2, type: 'Victory', style: null },
    { frame: 80, player: 1, type: 'Applause', style: null },
  ]);
});

test('set-end frustration is limited to an explicit error', () => {
  assert.deepEqual(buildDmoPointGestureEvents([
    { frame: 10, winner: 1, setNumber: 1 },
    { frame: 20, winner: 1, faults: 2, setNumber: 2 },
  ]), [
    { frame: 20, player: 1, type: 'RagingFist', style: null },
    { frame: 20, player: 2, type: 'Stupid', style: null },
  ]);
});

test('invalid point results are ignored', () => {
  assert.deepEqual(buildDmoPointGestureEvents([
    { frame: Number.NaN, winner: 1, rallyHits: 20 },
    { frame: 10, winner: null, rallyHits: 20 },
  ]), []);
});

test('selected gesture clips play only inside their event window with a fade-in', () => {
  const events = [
    { frame: 60, player: 1, type: 'CheerFist', style: null },
    { frame: 120, player: 2, type: 'Victory', style: null },
  ];
  const clips = { CheerFist: { duration: 1 }, Victory: { duration: 0.5 } };
  assert.equal(resolveDmoGesturePlayback(events, 1, 59, 60, clips), null);
  assert.deepEqual(resolveDmoGesturePlayback(events, 1, 66, 60, clips), {
    type: 'CheerFist',
    time: 0.1,
    weight: 0.8017492711370262,
  });
  assert.equal(resolveDmoGesturePlayback(events, 1, 121, 60, clips), null);
  assert.equal(resolveDmoGesturePlayback(events, 2, 160, 60, clips), null);
});
