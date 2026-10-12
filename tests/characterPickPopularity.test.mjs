import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatOrdinalRank,
  parseCharacterPickRanking,
} from '../lib/characterPickPopularity.ts';

test('accepts a Core API rank only when it agrees with the official pick total', () => {
  const rank = {
    rank: 2,
    picks: 857,
    tied: false,
    character_count: 102,
  };

  assert.deepEqual(parseCharacterPickRanking(rank, 857), rank);
  assert.equal(parseCharacterPickRanking(rank, 856), null);
  assert.equal(parseCharacterPickRanking({ ...rank, rank: 103 }, 857), null);
});

test('rejects incomplete or malformed official ranks', () => {
  assert.equal(parseCharacterPickRanking({ rank: 1, picks: 9 }, 9), null);
  assert.equal(parseCharacterPickRanking(null, 9), null);
});

test('formats ordinal ranks including the teen suffix exception', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 11, 12, 13, 21].map(formatOrdinalRank),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st'],
  );
});
