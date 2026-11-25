import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCharacterPickBrackets,
  getChallongeTournamentId,
  getChallongeTournamentUrl,
} from '../lib/challongeBracket.ts';

const PARIS_OFFICIAL_URL =
  'https://www.playwtsl.com/TE4/pages/tournament.php?tour=TE4&tournament=Paris_2026_TE4';

test('resolves only a valid tournament id from the official WTSL page', () => {
  assert.equal(getChallongeTournamentId(PARIS_OFFICIAL_URL), 'Paris_2026_TE4');
  assert.equal(
    getChallongeTournamentUrl(PARIS_OFFICIAL_URL),
    'https://91d510368cb4170cd5ac3776.challonge.com/Paris_2026_TE4',
  );
  assert.equal(
    getChallongeTournamentId('https://attacker.example/?tournament=Paris_2026_TE4'),
    null,
  );
  assert.equal(
    getChallongeTournamentId('https://www.playwtsl.com/?tournament=Paris_2026_TE4%2Fextra'),
    null,
  );
});

test('puts character picks in square brackets in player labels and tooltips', () => {
  const source = `<?xml version="1.0"?>
    <svg id="top_level" xmlns="http://www.w3.org/2000/svg">
      <svg class="match--player" data-participant-id="1">
        <title>(1) gifu (S. Tsitsipas)</title>
        <text class="match--player-name -winner">(1) gifu (S. Tsitsipas)</text>
        <text class="match--player-score">2</text>
      </svg>
      <svg class="match--player" data-participant-id="2">
        <title>Madferit (R. Federer)</title>
        <text class="match--player-name">Madferit (R. Federer)</text>
        <text class="match--player-score">1</text>
      </svg>
    </svg>`;

  const result = addCharacterPickBrackets(source);
  assert.match(result, /<title>\(1\) gifu \[S\. Tsitsipas\]<\/title>/);
  assert.match(result, /<text class="match--player-name -winner">\(1\) gifu \[S\. Tsitsipas\]<\/text>/);
  assert.match(result, /<title>Madferit \[R\. Federer\]<\/title>/);
  assert.match(result, /<text class="match--player-name">Madferit \[R\. Federer\]<\/text>/);
  assert.match(result, /<text class="match--player-score">2<\/text>/);
});

test('keeps bracket labels unchanged when no character pick is present', () => {
  const source = `<svg id="top_level"><svg class="match--player">
    <title>Winner of match 2</title>
    <text class="match--player-name">Winner of match 2</text>
  </svg></svg>`;

  const result = addCharacterPickBrackets(source);
  assert.match(result, /<title>Winner of match 2<\/title>/);
  assert.match(result, /<text class="match--player-name">Winner of match 2<\/text>/);
});

test('escapes XML characters after formatting the pick label', () => {
  const source = `<svg id="top_level"><svg class="match--player">
    <title>A &amp; B (R. Federer)</title>
    <text class="match--player-name">A &amp; B (R. Federer)</text>
  </svg></svg>`;

  const result = addCharacterPickBrackets(source);
  assert.match(result, /A &amp; B \[R\. Federer\]/);
});
