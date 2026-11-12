import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildDmoCommentaryFacts,
  buildDmoCommentaryIntroduction,
  buildDmoPointCommentary,
  rankDmoBrowserVoices,
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
    "We're at Shanghai Masters. Quarter-final action: Naomi Osaka against Daniil Medvedev on the hard courts.",
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
    "In the WTSL ATP rankings, Naomi Osaka is number 3, with Daniil Medvedev at number 9. There's a little history here: Naomi Osaka leads their WTSL head-to-head, 2 to 1.",
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
    "There's nothing between them in WTSL play: 2 wins apiece.",
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
    'Shot after shot, and Player One comes through.',
  );
  assert.equal(
    buildDmoPointCommentary(
      { number: 2, winner: 2, server: 1, rallyHits: 9 },
      ['Player One', 'Player Two'],
    ),
    'A real test of legs and nerve — Player Two takes it.',
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
    "And that's the break for Player Two!",
  );
  assert.equal(
    buildDmoPointCommentary({
      winner: 1,
      server: 1,
      rallyHits: 2,
      scoreBeforeLabel: '40-AD',
    }, ['Player One', 'Player Two']),
    'The pressure stays on, but Player One saves the break point.',
  );
  assert.equal(
    buildDmoPointCommentary({
      winner: 1,
      server: 1,
      rallyHits: 3,
      scoreBeforeLabel: '0-0(40-30)',
    }, ['Player One', 'Player Two']),
    'Game point converted — Player One closes it out.',
  );
  assert.equal(
    buildDmoPointCommentary({
      winner: 1,
      server: 2,
      rallyHits: 3,
      scoreBeforeLabel: '40-30',
    }, ['Player One', 'Player Two']),
    "And that's the break for Player One!",
  );
});

test('browser commentary voice ranking filters to English and prefers natural voices', () => {
  const voices = rankDmoBrowserVoices([
    { voiceURI: 'us-basic', name: 'English US', lang: 'en-US', localService: true },
    { voiceURI: 'uk-basic', name: 'English UK', lang: 'en-GB', localService: true },
    { voiceURI: 'uk-neural', name: 'English UK Neural', lang: 'en-GB', localService: false },
    { voiceURI: 'french', name: 'French', lang: 'fr-FR', localService: true },
  ]);

  assert.deepEqual(voices.map((voice) => voice.voiceURI), [
    'uk-neural',
    'uk-basic',
    'us-basic',
  ]);
});

test('commentary stays spoken-only with no court text bubble', async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/DmoLiveCourt3D.module.css', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(component, /commentary\.message|commentaryCaption/);
  assert.doesNotMatch(styles, /commentaryCaption/);
});
