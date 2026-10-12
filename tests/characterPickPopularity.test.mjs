import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatOrdinalRank,
  rankCharacterPickCounts,
} from '../lib/characterPickPopularity.ts';

test('ranks a character against the same recorded pick totals as its profile', () => {
  const rank = rankCharacterPickCounts([
    { character: 'A', picks: 18 },
    { character: 'B', picks: '12' },
    { character: 'C', picks: 4 },
  ], 'B', 12);

  assert.deepEqual(rank, { rank: 2, picks: 12, tied: false });
});

test('shares competition rank for ties and combines case-insensitive duplicates', () => {
  const rank = rankCharacterPickCounts([
    { character: 'A', picks: 12 },
    { character: 'B', picks: 8 },
    { character: 'b', picks: 2 },
    { character: 'C', picks: 10 },
  ], 'B', 10);

  assert.deepEqual(rank, { rank: 2, picks: 10, tied: true });
});

test('does not report a rank when the saved source total disagrees with the profile', () => {
  assert.equal(rankCharacterPickCounts([
    { character: 'A', picks: 10 },
    { character: 'B', picks: 8 },
  ], 'B', 9), null);
});

test('formats ordinal ranks including the teen suffix exception', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 11, 12, 13, 21].map(formatOrdinalRank),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st'],
  );
});
