import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateCharacterUsage } from '../lib/characterUsage.ts';

test('counts recorded picks regardless of match score status', () => {
  const aggregate = aggregateCharacterUsage([
    {
      player1Id: 'player-1',
      player1Character: 'R. Federer',
      player2Id: 'player-2',
      player2Character: 'N. Djokovic',
      score: '6-4 6-4',
    },
    {
      player1Id: 'player-1',
      player1Character: ' R. Federer ',
      player2Id: 'player-3',
      player2Character: 'A. Murray',
      score: 'Walkover',
    },
    {
      player1Id: 'player-2',
      player1Character: null,
      player2Id: 'player-3',
      player2Character: 'a. murray',
      score: 'Coin Toss (4-5)',
    },
  ]);

  assert.deepEqual(aggregate.entries, [
    { playerId: 'player-1', character: 'R. Federer', picks: 2 },
    { playerId: 'player-2', character: 'N. Djokovic', picks: 1 },
    { playerId: 'player-3', character: 'A. Murray', picks: 2 },
  ]);
  assert.deepEqual(aggregate.summaries, [
    {
      playerId: 'player-1',
      favoriteCharacter: 'R. Federer',
      favoriteCharacterPicks: 2,
      characterMatches: 2,
    },
    {
      playerId: 'player-2',
      favoriteCharacter: 'N. Djokovic',
      favoriteCharacterPicks: 1,
      characterMatches: 1,
    },
    {
      playerId: 'player-3',
      favoriteCharacter: 'A. Murray',
      favoriteCharacterPicks: 2,
      characterMatches: 2,
    },
  ]);
  assert.equal(aggregate.picksCounted, 5);
});
