import assert from 'node:assert/strict';
import test from 'node:test';
import { getChallongeTournamentId, getChallongeTournamentUrl } from '../lib/challongeBracket.ts';
import { parseChallongeBracketSvg } from '../lib/challongeBracketData.ts';
import { attachOfficialTournamentResults } from '../lib/tournamentBracketResults.ts';

const PARIS_OFFICIAL_URL =
  'https://www.playwtsl.com/TE4/pages/tournament.php?tour=TE4&tournament=Paris_2026_TE4';

function bracketSvg({
  secondName = '(2) Madferit (R. Federer)',
  includeConnector = true,
} = {}) {
  return `<svg id="top_level" width="700" height="300" viewBox="0 0 700 300">
    <g class="rounds" transform="translate(0,0)">
      <svg class="round" x="0">
        <g class="round-label"><text>Final</text><text class="round-label--best-of">Best of 3</text></g>
      </svg>
    </g>
    ${includeConnector ? '<g class="bracket-line-container" transform="translate(204 26)"><path class="bracket-line" d="M 0 0 L 16 0"></path></g>' : ''}
    <g class="match -complete" data-identifier="1" data-match-id="match-1" transform="translate(0 100)">
      <svg class="match--player" data-participant-id="1">
        <title>(1) gifu (S. Tsitsipas)</title>
        <text class="match--player-name -winner">(1) gifu (S. Tsitsipas)</text>
        <text class="match--player-score -winner">2</text>
      </svg>
      <svg class="match--player" data-participant-id="2">
        <title>${secondName}</title>
        <text class="match--player-name">${secondName}</text>
        <text class="match--player-score">1</text>
      </svg>
    </g>
  </svg>`;
}

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

test('parses a native bracket and formats player character picks', () => {
  const result = parseChallongeBracketSvg(bracketSvg());
  assert.equal(result.width, 700);
  assert.equal(result.height, 300);
  assert.equal(result.main.length, 1);
  assert.equal(result.main[0].name, 'Final');
  assert.equal(result.main[0].bestOf, 'Best of 3');
  assert.equal(result.main[0].matches.length, 1);
  assert.equal(result.main[0].matches[0].team1, 'gifu [S. Tsitsipas]');
  assert.equal(result.main[0].matches[0].team2, 'Madferit [R. Federer]');
  assert.equal(result.main[0].matches[0].team1Seed, '1');
  assert.deepEqual(result.main[0].matches[0].scores, ['2', '1']);
  assert.equal(result.main[0].matches[0].winner, 1);
  assert.equal(result.main[0].matches[0].status, 'complete');
  assert.equal(result.connectors.length, 1);
});

test('keeps empty character picks and placeholder names unchanged', () => {
  const result = parseChallongeBracketSvg(
    bracketSvg({ secondName: 'Winner of match 2' }),
  );
  assert.equal(result.main[0].matches[0].team2, 'Winner of match 2');
});

test('decodes XML entities before drawing labels', () => {
  const result = parseChallongeBracketSvg(
    bracketSvg({ secondName: 'A &amp; B (R. Federer)' }),
  );
  assert.equal(result.main[0].matches[0].team2, 'A & B [R. Federer]');
});

test('keeps winners and losers sections separate in double-elimination draws', () => {
  const source = `<svg id="top_level" width="700" height="500" viewBox="0 0 700 500">
    <g class="rounds" transform="translate(0 0)">
      <svg class="round" x="0"><g class="round-label"><text>Winners Final</text></g></svg>
    </g>
    <g class="rounds" transform="translate(0 200)">
      <svg class="round" x="0"><g class="round-label"><text>Losers Final</text></g></svg>
    </g>
    <g class="bracket-line-container" transform="translate(204 26)">
      <path class="bracket-line" d="M 0 0 L 16 0"></path>
    </g>
    <g class="bracket-line-container" transform="translate(204 226)">
      <path class="bracket-line" d="M 0 0 L 16 0"></path>
    </g>
    <g class="match" data-match-id="winners-match" transform="translate(0 100)">
      <svg class="match--player" data-participant-id="1"><title>Player A (A. Zverev)</title></svg>
      <svg class="match--player" data-participant-id="2"><title>Player B (H. Rune)</title></svg>
    </g>
    <g class="match" data-match-id="losers-match" transform="translate(0 300)">
      <svg class="match--player" data-participant-id="3"><title>Player C (C. Alcaraz)</title></svg>
      <svg class="match--player" data-participant-id="4"><title>Player D (R. Federer)</title></svg>
    </g>
  </svg>`;

  const result = parseChallongeBracketSvg(source);
  assert.equal(result.winners[0].matches[0].team1, 'Player A [A. Zverev]');
  assert.equal(result.losers[0].matches[0].team1, 'Player C [C. Alcaraz]');
  assert.equal(result.main.length, 0);
});

test('rejects SVGs that are not complete bracket draws', () => {
  assert.throws(
    () => parseChallongeBracketSvg(bracketSvg({ includeConnector: false })),
    /progression paths/,
  );
  assert.throws(() => parseChallongeBracketSvg('<svg id="wrong"></svg>'), /bracket SVG/);
});

test('attaches full official set scores and the official winner in bracket order', () => {
  const bracket = parseChallongeBracketSvg(bracketSvg());
  const enriched = attachOfficialTournamentResults(bracket, [{
    player_one_id: '2',
    player_two_id: '1',
    player_one_name: 'Madferit',
    player_two_name: 'gifu',
    winner_id: '2',
    score: '6-3 7-6(7) 6-4',
    round_name: 'Final',
    source_id: 'recent:TE4:Paris',
  }]);

  const match = enriched.main[0].matches[0];
  assert.equal(match.officialScore, '3-6 6-7(7) 4-6');
  assert.equal(match.winner, 2);
});

test('preserves special result text and refuses conflicting score matches', () => {
  const bracket = parseChallongeBracketSvg(bracketSvg());
  const special = attachOfficialTournamentResults(bracket, [{
    player_one_id: '1',
    player_two_id: '2',
    player_one_name: 'gifu',
    player_two_name: 'Madferit',
    winner_id: '1',
    score: 'Coin Toss (6-3)',
    round_name: 'Final',
    source_id: 'recent:TE4:Paris',
  }]);
  assert.equal(special.main[0].matches[0].officialScore, 'Coin Toss (6-3)');

  const ambiguous = attachOfficialTournamentResults(bracket, [
    {
      player_one_name: 'gifu', player_two_name: 'Madferit', score: '6-2 6-2',
      round_name: 'Final', source_id: 'recent:TE4:first',
    },
    {
      player_one_name: 'gifu', player_two_name: 'Madferit', score: '6-3 6-3',
      round_name: 'Final', source_id: 'recent:TE4:second',
    },
  ]);
  assert.equal(ambiguous.main[0].matches[0].officialScore, null);
});
