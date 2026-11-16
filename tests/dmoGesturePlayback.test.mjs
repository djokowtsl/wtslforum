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

test('a set lost on your own error (here a double fault) is the racket throw', () => {
  assert.deepEqual(buildDmoPointGestureEvents([
    { frame: 10, winner: 1, setNumber: 1 },
    { frame: 20, winner: 1, faults: 2, setNumber: 2 },
  ]), [
    { frame: 20, player: 1, type: 'RagingFist', style: null },
    { frame: 20, player: 2, type: 'ThrowRacket', style: null },
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

test('breaks of serve and set wins are found from the score after each point', () => {
  const events = buildDmoPointGestureEvents([
    { frame: 10, winner: 2, server: 1, rallyHits: 3, setNumber: 1, scoreLabel: '0-0(0-15)' },
    // Receiver wins the game on the server's error: a break.
    { frame: 20, winner: 2, server: 1, rallyHits: 3, setNumber: 1, scoreLabel: '0-1(0-0)', endedBy: 'error' },
    // Servers hold: no gesture.
    { frame: 30, winner: 2, server: 2, rallyHits: 3, setNumber: 1, scoreLabel: '0-2(0-0)' },
    { frame: 35, winner: 1, server: 1, rallyHits: 3, setNumber: 1, scoreLabel: '1-2(0-0)' },
    // Set won (setNumber counts the set after the point).
    { frame: 40, winner: 2, server: 2, rallyHits: 3, setNumber: 2, scoreLabel: '0-0(0-0)' },
    // Double fault.
    { frame: 50, winner: 1, server: 2, rallyHits: 0, faults: 2, setNumber: 2, scoreLabel: '0-0(15-0)' },
  ]);
  assert.deepEqual(events.map(({ frame, player, type }) => `${frame}:${player}:${type}`), [
    '20:2:CheerFist', '20:1:Stupid',
    '40:2:RagingFist', '40:1:HitRacket',
    '50:2:Stupid',
  ]);
});

test('a tiebreak game is not a break, and a deciding-set win is a big victory', () => {
  const tiebreak = buildDmoPointGestureEvents([
    { frame: 10, winner: 2, server: 1, rallyHits: 3, setNumber: 1, isTiebreak: true, scoreLabel: '6-6(0-0)' },
  ]);
  assert.deepEqual(tiebreak, []);
  const deciding = buildDmoPointGestureEvents([
    { frame: 10, winner: 1, server: 1, rallyHits: 3, setNumber: 3, scoreLabel: '5-4(40-0)' },
    { frame: 20, winner: 1, server: 1, rallyHits: 3, setNumber: 4, scoreLabel: '0-0(0-0)' },
  ], { matchOver: true, bestOf: 3 });
  assert.deepEqual(deciding.map((event) => event.type), ['VictoryGreat', 'Applause']);
  const straight = buildDmoPointGestureEvents([
    { frame: 10, winner: 1, server: 1, rallyHits: 3, setNumber: 2, scoreLabel: '5-4(40-0)' },
    { frame: 20, winner: 1, server: 1, rallyHits: 3, setNumber: 3, scoreLabel: '0-0(0-0)' },
  ], { matchOver: true, bestOf: 3 });
  assert.deepEqual(straight.map((event) => event.type), ['Victory', 'Applause']);
});

test('long rallies scale their reaction with the rally', () => {
  const events = buildDmoPointGestureEvents([
    { frame: 10, winner: 1, server: 1, rallyHits: 12, scoreLabel: '0-0(15-0)', endedBy: 'winner' },
    { frame: 20, winner: 2, server: 1, rallyHits: 22, scoreLabel: '0-0(15-15)', endedBy: 'winner' },
    { frame: 30, winner: 1, server: 1, rallyHits: 31, scoreLabel: '0-0(30-15)', endedBy: 'error' },
  ]);
  assert.deepEqual(events.map(({ frame, player, type }) => `${frame}:${player}:${type}`), [
    '10:1:CheerFist',
    '20:2:RagingFist', '20:1:Applause',
    '30:1:CheerJump', '30:2:Stupid',
  ]);
});

test('gestures the player really made override the inferred one for that player', () => {
  const events = buildDmoPointGestureEvents([
    {
      frame: 100, winner: 1, server: 2, rallyHits: 25, scoreLabel: '0-0(15-0)', endedBy: 'winner',
      recordedGestures: [{ player: 1, type: 'cheerjump', frame: 130 }, { player: 1, type: 'Sorry' }],
    },
    { frame: 200, winner: 2, server: 2, rallyHits: 3, scoreLabel: '0-0(15-15)', recordedGestures: [{ player: 1, type: 'Stupid' }] },
    { frame: 300, winner: 2, server: 2, rallyHits: 3, scoreLabel: '0-0(15-30)', recordedGestures: [{ player: 3, type: 'Stupid' }, { player: 2, type: 'dance' }] },
  ]);
  assert.deepEqual(events.map(({ frame, player, type, recorded }) => `${frame}:${player}:${type}:${recorded ? 'real' : 'inferred'}`), [
    '100:2:Applause:inferred', // the other player keeps the inferred reaction
    '130:1:CheerJump:real', // the first real gesture replaces RagingFist
    '200:1:Stupid:real', // real gestures show even on quiet points
  ], 'unknown players and gesture types are ignored');
});
