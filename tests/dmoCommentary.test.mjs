import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDmoCommentaryFacts,
  buildDmoCommentaryIntroduction,
  buildDmoPointCommentary,
} from '../lib/dmoCommentary.mjs';
import {
  getDmoCharacterAppearance,
  getDmoCharacterComplexionColor,
} from '../lib/dmoCharacterAppearance.mjs';

test('curated complexion colors follow the character name and keep unknowns at the default', () => {
  assert.equal(getDmoCharacterComplexionColor('Naomi Osaka'), 0x805440);
  assert.equal(getDmoCharacterComplexionColor('WTA - Naomi Osaka'), 0x805440);
  assert.equal(getDmoCharacterAppearance('Daniil Medvedev').complexionColor, 0xd8ad92);
  assert.equal(getDmoCharacterAppearance('Sumit Nagal').complexionColor, 0xa87658);
  assert.equal(getDmoCharacterComplexionColor('Unknown Player'), null);
});

test('introduction uses only supplied tournament and verified WTSL facts', () => {
  const intro = buildDmoCommentaryIntroduction({
    names: ['Naomi Osaka', 'Daniil Medvedev'],
    tournament: 'Shanghai Masters',
    surface: 'Hard',
    round: 'Quarter-final',
    context: {
      tour: 'ATP',
      players: [{ rank: 3, tourElo: 1920 }, { rank: null, tourElo: null }],
      headToHead: { firstWins: 2, secondWins: 1, matches: 3 },
    },
  });

  assert.match(intro, /at Shanghai Masters on hard court, Quarter-final/);
  assert.match(intro, /ranked No\. 3 in the WTSL ATP/);
  assert.match(intro, /has a WTSL Tour Elo of 1920/);
  assert.match(intro, /official WTSL head-to-head stands at Naomi Osaka 2, Daniil Medvedev 1/);
  assert.doesNotMatch(intro, /Daniil Medvedev comes in with/);
  assert.match(
    buildDmoCommentaryFacts({
      names: ['Naomi Osaka', 'Daniil Medvedev'],
      context: { tour: 'ATP', players: [{ rank: 3 }, { rank: 9 }] },
    }),
    /Naomi Osaka is ranked No\. 3 in the WTSL ATP/,
  );
});

test('point commentary reacts to the confirmed server, winner, and shot count', () => {
  assert.equal(
    buildDmoPointCommentary(
      { winner: 2, server: 1, rallyHits: 5, scoreLabel: '15-30' },
      ['Player One', 'Player Two'],
    ),
    'A strong return point from Player Two. The point began at 15-30.',
  );
  assert.equal(
    buildDmoPointCommentary({ winner: 1, server: 1, rallyHits: 12 }, ['Player One', 'Player Two']),
    'An extended 12-shot point, and Player One wins the exchange.',
  );
  assert.equal(buildDmoPointCommentary({ winner: 0 }, ['Player One', 'Player Two']), '');
});
