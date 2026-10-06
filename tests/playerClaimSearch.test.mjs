import assert from 'node:assert/strict';
import test from 'node:test';
import { exactPlayerNameMatches } from '../lib/playerClaimSearch.ts';

test('typed full names resolve case-insensitively after trimming whitespace', () => {
  const players = [
    { wtsl_player_id: '1', name: 'HSM09' },
    { wtsl_player_id: '2', name: 'HSM09 Returner' },
  ];

  assert.deepEqual(exactPlayerNameMatches(players, ' Hsm09 '), [players[0]]);
});

test('partial names are not silently treated as a selected player', () => {
  const players = [{ wtsl_player_id: '1', name: 'HSM09' }];

  assert.deepEqual(exactPlayerNameMatches(players, 'HSM'), []);
});

test('duplicate exact names remain ambiguous and require choosing a suggestion', () => {
  const players = [
    { wtsl_player_id: '1', name: 'HSM09' },
    { wtsl_player_id: '2', name: 'HSM09' },
  ];

  assert.equal(exactPlayerNameMatches(players, 'hsm09').length, 2);
});

test('empty input does not match players with empty names', () => {
  assert.deepEqual(exactPlayerNameMatches([{ name: '' }], '  '), []);
});