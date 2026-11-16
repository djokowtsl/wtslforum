import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DMO_GESTURES, chooseDmoPointGestures, dmoGestureType, getDmoCharacterGestures,
} from '../lib/dmoCharacterGestures.mjs';

test('the ten Tennis Elbow gesture types keep the game\'s numbering', () => {
  assert.deepEqual(DMO_GESTURES.map((gesture) => gesture.part), [300, 301, 302, 303, 304, 305, 306, 307, 308, 309]);
  assert.equal(dmoGestureType('cheerfist'), 'CheerFist');
  assert.equal(dmoGestureType('ThrowRacquet'), 'ThrowRacket', 'the mod spells it both ways');
  assert.equal(dmoGestureType('volley'), null);
});

test('characters get their own styles from the WTSL mod, newest version first', () => {
  assert.deepEqual(getDmoCharacterGestures('Novak Djokovic'), { CheerFist: 7, RagingFist: 4, Stupid: 2, ThrowRacket: 6 });
  assert.deepEqual(getDmoCharacterGestures('Roger Federer (ATP)'), getDmoCharacterGestures('roger federer'));
  assert.deepEqual(getDmoCharacterGestures('Someone Unknown'), {});
  assert.deepEqual(getDmoCharacterGestures(null), {});
});

test('every situation gets its gesture, while ordinary points stay quiet', () => {
  assert.deepEqual(chooseDmoPointGestures({ winner: 1, server: 1, rallyHits: 4 }), [], 'an ordinary point has none');
  // Long rallies: the reaction grows with the rally.
  assert.deepEqual(chooseDmoPointGestures({ winner: 2, rallyHits: 14 }), [{ player: 2, type: 'CheerFist' }]);
  assert.deepEqual(chooseDmoPointGestures({ winner: 2, rallyHits: 24, endedBy: 'winner' }),
    [{ player: 2, type: 'RagingFist' }, { player: 1, type: 'Applause' }], 'a great rally is applauded');
  assert.deepEqual(chooseDmoPointGestures({ winner: 1, rallyHits: 33, endedBy: 'error' }),
    [{ player: 1, type: 'CheerJump' }, { player: 2, type: 'Stupid' }], 'losing it on an error frustrates');
  assert.deepEqual(chooseDmoPointGestures({ winner: 1, rallyHits: 15, endedBy: 'winner' }),
    [{ player: 1, type: 'CheerFist' }], 'a shorter long rally is not applauded');
  // Breaks and sets: the loser's reaction depends on how it ended.
  assert.deepEqual(chooseDmoPointGestures({ winner: 1, server: 2, importance: 'break', endedBy: 'error' }),
    [{ player: 1, type: 'CheerFist' }, { player: 2, type: 'Stupid' }]);
  assert.deepEqual(chooseDmoPointGestures({ winner: 1, server: 2, importance: 'break', endedBy: 'winner' }),
    [{ player: 1, type: 'CheerFist' }, { player: 2, type: 'HitRacket' }]);
  assert.deepEqual(chooseDmoPointGestures({ winner: 2, importance: 'set', endedBy: 'winner' }),
    [{ player: 2, type: 'RagingFist' }, { player: 1, type: 'HitRacket' }]);
  assert.deepEqual(chooseDmoPointGestures({ winner: 2, importance: 'set', endedBy: 'error' }),
    [{ player: 2, type: 'RagingFist' }, { player: 1, type: 'ThrowRacket' }], 'a set thrown away');
  assert.deepEqual(chooseDmoPointGestures({ winner: 2, importance: 'set', tiebreak: true }),
    [{ player: 2, type: 'CheerJump' }, { player: 1, type: 'HitRacket' }]);
  assert.deepEqual(chooseDmoPointGestures({ winner: 2, server: 1, doubleFault: true }),
    [{ player: 1, type: 'Stupid' }], 'a double fault frustrates the server');
  assert.deepEqual(chooseDmoPointGestures({ winner: 1, importance: 'match' }),
    [{ player: 1, type: 'Victory' }, { player: 2, type: 'Applause' }]);
  assert.deepEqual(chooseDmoPointGestures({ winner: 1, importance: 'match', decidingSet: true }),
    [{ player: 1, type: 'VictoryGreat' }, { player: 2, type: 'Applause' }]);
});
