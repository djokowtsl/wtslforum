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

test('fallback gestures stay rare and fit the moment', () => {
  assert.deepEqual(chooseDmoPointGestures({ winner: 1 }), [], 'an ordinary point has none');
  assert.deepEqual(chooseDmoPointGestures({ winner: 2, rallyHits: 14, endedBy: 'winner' }),
    [{ player: 2, type: 'CheerFist' }, { player: 1, type: 'Applause' }]);
  assert.deepEqual(chooseDmoPointGestures({ winner: 1, importance: 'break', endedBy: 'error' }),
    [{ player: 1, type: 'CheerFist' }, { player: 2, type: 'Stupid' }]);
  assert.deepEqual(chooseDmoPointGestures({ winner: 2, importance: 'set' }), [{ player: 2, type: 'RagingFist' }]);
  assert.deepEqual(chooseDmoPointGestures({ winner: 1, importance: 'match' }),
    [{ player: 1, type: 'Victory' }, { player: 2, type: 'Applause' }]);
});
