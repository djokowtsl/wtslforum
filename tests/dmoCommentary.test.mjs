import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('introduction sounds like a broadcast and uses verified WTSL context', () => {
  const intro = buildDmoCommentaryIntroduction({
    names: ['Naomi Osaka', 'Daniil Medvedev'],
    tournament: 'Shanghai Masters',
    surface: 'Hard',
    round: 'Quarter-final',
  });

  assert.equal(
    intro,
    'At Shanghai Masters, Naomi Osaka takes on Daniil Medvedev on the hard courts in the quarter-final.',
  );
  assert.equal(
    buildDmoCommentaryFacts({
      names: ['Naomi Osaka', 'Daniil Medvedev'],
      context: {
        tour: 'ATP',
        players: [{ rank: 3, tourElo: 1920 }, { rank: 9, tourElo: 1870 }],
        headToHead: { firstWins: 2, secondWins: 1, matches: 3 },
      },
    }),
    'The WTSL ATP rankings have Naomi Osaka at No. 3 and Daniil Medvedev at No. 9. Naomi Osaka leads their WTSL meetings, 2–1.',
  );
  assert.match(
    buildDmoCommentaryFacts({
      names: ['Naomi Osaka', 'Daniil Medvedev'],
      context: { tour: 'ATP', players: [{ rank: null, tourElo: 1920 }, { rank: null, tourElo: 1870 }] },
    }),
    /Tour Elo ratings are 1,920 and 1,870/,
  );
  assert.equal(
    buildDmoCommentaryFacts({
      names: ['Player One', 'Player Two'],
      context: { tour: 'ATP', players: [], headToHead: { firstWins: 2, secondWins: 2, matches: 4 } },
    }),
    'Their WTSL meetings are level at 2 apiece.',
  );
});

test('routine points stay silent and longer rallies get varied, natural calls', () => {
  assert.equal(
    buildDmoPointCommentary(
      { winner: 2, server: 1, rallyHits: 5 },
      ['Player One', 'Player Two'],
    ),
    '',
  );
  assert.equal(
    buildDmoPointCommentary(
      { number: 1, winner: 1, server: 1, rallyHits: 12, scoreBeforeLabel: '15-30' },
      ['Player One', 'Player Two'],
    ),
    'What a rally! Player One comes away with it.',
  );
  assert.equal(
    buildDmoPointCommentary(
      { number: 2, winner: 2, server: 1, rallyHits: 9 },
      ['Player One', 'Player Two'],
    ),
    'A wonderful rally, finished off by Player Two.',
  );
  assert.equal(buildDmoPointCommentary({ winner: 0 }, ['Player One', 'Player Two']), '');
});

test('pressure-point calls distinguish a break, a save, and a game point', () => {
  assert.equal(
    buildDmoPointCommentary({
      winner: 2,
      server: 1,
      rallyHits: 3,
      scoreBeforeLabel: '2-3(30-40)',
    }, ['Player One', 'Player Two']),
    "And that's the break for Player Two.",
  );
  assert.equal(
    buildDmoPointCommentary({
      winner: 1,
      server: 1,
      rallyHits: 2,
      scoreBeforeLabel: '40-AD',
    }, ['Player One', 'Player Two']),
    'Player One saves the break point.',
  );
  assert.equal(
    buildDmoPointCommentary({
      winner: 1,
      server: 1,
      rallyHits: 3,
      scoreBeforeLabel: '0-0(40-30)',
    }, ['Player One', 'Player Two']),
    "That's the game for Player One.",
  );
  assert.equal(
    buildDmoPointCommentary({
      winner: 1,
      server: 2,
      rallyHits: 3,
      scoreBeforeLabel: '40-30',
    }, ['Player One', 'Player Two']),
    "And that's the break for Player One.",
  );
});

test('commentary stays spoken-only with no court text bubble', async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoLiveCourt3D.module.css', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(component, /commentary\.message|commentaryCaption/);
  assert.doesNotMatch(styles, /commentaryCaption/);
});
