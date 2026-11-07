import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inferredOneHandedBackhandPlayer,
  matchingPlayerIndex,
} from '../lib/liveCharacterBackhand.mjs';

test('matches a selected character to one DMO player by normalized name', () => {
  assert.equal(matchingPlayerIndex(['A. Player', 'Lucía_Example'], 'lucia example'), 1);
});

test('does not infer a style for missing, unmatched, or ambiguous names', () => {
  assert.equal(matchingPlayerIndex(['Player One', 'Player Two'], 'Another Player'), null);
  assert.equal(matchingPlayerIndex(['Alex', 'ALEX'], 'Alex'), null);
  assert.equal(matchingPlayerIndex(['Player One'], ''), null);
});

test('infers one-handed backhand only from a one-handed character profile', () => {
  const players = ['Player One', 'Player Two'];
  assert.equal(inferredOneHandedBackhandPlayer(players, 'PLAYER TWO', 'one-handed'), 1);
  assert.equal(inferredOneHandedBackhandPlayer(players, 'Player Two', 'two-handed'), null);
  assert.equal(inferredOneHandedBackhandPlayer(players, 'Player Two', null), null);
});
