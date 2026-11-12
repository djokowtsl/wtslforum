import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatLivePlayerElos,
  parseLiveWtslMatches,
  readOfficialH2HRecord,
  resolveLivePlayer,
} from '../lib/liveScoreModel.ts';

test('live player resolution keeps exact normalized ranked names', () => {
  const franky = { id: '917', name: 'Franky Franchicha' };
  const players = new Map([
    ['franky franchicha', franky],
    ['thetinkerman_', { id: '1216', name: 'TheTinkerman_' }],
  ]);

  assert.equal(resolveLivePlayer('franky franchicha', players), franky);
  assert.equal(resolveLivePlayer('thetinkerman_', players).id, '1216');
});

test('an initial-and-surname live name resolves to a unique ranked player', () => {
  const franky = { id: '917', name: 'Franky Franchicha' };
  const players = new Map([['franky franchicha', franky]]);

  assert.equal(resolveLivePlayer('f.franchicha', players), franky);
  assert.equal(resolveLivePlayer('f. franchicha', players), franky);
});

test('an ambiguous initial-and-surname live name remains unresolved', () => {
  const players = new Map([
    ['franky franchicha', { id: '917', name: 'Franky Franchicha' }],
    ['felix franchicha', { id: '918', name: 'Felix Franchicha' }],
  ]);

  assert.equal(resolveLivePlayer('f.franchicha', players), null);
});

test('unmatched or unsupported abbreviations do not guess a ranked player', () => {
  const players = new Map([
    ['franky franchicha', { id: '917', name: 'Franky Franchicha' }],
    ['juan martin del potro', { id: '919', name: 'Juan Martin del Potro' }],
  ]);

  assert.equal(resolveLivePlayer('x.unknown', players), null);
  assert.equal(resolveLivePlayer('f.franchicha extra', players), null);
  assert.equal(resolveLivePlayer('f.del potro', players), null);
});

test('live WTSL feed parses both players’ in-game Elo values', () => {
  const poll = '0 1 "Player One vs Player Two" 40 00 05dc 00 "XKT(WTSL) ATP" "1-0, 2-1" 0666 00 00 "1 Clay Court" trailer';
  const [match] = parseLiveWtslMatches(poll);

  assert.equal(match.inGameElo1, 1500);
  assert.equal(match.inGameElo2, 1638);
  assert.equal(match.mode, 'Singles');
  assert.equal(match.bestOf, 3);
  assert.equal(match.court, 'Clay Court');
});

test('live WTSL hosting tag identifies WTA matches independently of the host version suffix', () => {
  const poll = '0 1 "Player One vs Player Two" 40 00 05dc 00 "WTA - XKT(WTSL) v4.4k" "1-0, 2-1" 0666 00 00 "1 Clay Court" trailer';
  const [match] = parseLiveWtslMatches(poll);

  assert.equal(match.tagline, 'WTA - XKT(WTSL) v4.4k');
  assert.equal(match.tourHint, 'TE4_(F)');
});

test('live Elo labels match the Discord embed and omit unavailable ratings', () => {
  assert.equal(formatLivePlayerElos(1500, 1638), '[Game: 1500 | Tour: 1638]');
  assert.equal(formatLivePlayerElos(1500, null), '[Game: 1500]');
  assert.equal(formatLivePlayerElos(null, 1638), '[Tour: 1638]');
  assert.equal(formatLivePlayerElos(0, 0), null);
});

const officialWtaH2hHtml = `
  <select><option selected value="939">First Player</option></select>
  <select><option selected value="944">Second Player</option></select>
  <table class="table table-hover results-table">
    <tr><th>Date</th><th>Tour</th><th>Tournament</th><th>Competition</th><th>Round</th><th>Winner</th><th>Score</th></tr>
    <tr><td>30.11.2025</td><td></td><td>WTA Final</td><td>Singles</td><td>Final</td>
      <td><a href="player_page.php?player=939">First Player</a></td><td>6-4,3-6,6-2</td></tr>
    <tr><td>08.06.2025</td><td></td><td>WTA Open</td><td>Singles</td><td>Semifinal</td>
      <td><a href="player_page.php?player=944">Second Player</a></td><td>7-5,6-3</td></tr>
    <tr><td>01.06.2025</td><td></td><td>WTA Open</td><td>Singles</td><td>Quarterfinal</td>
      <td><a href="player_page.php?player=939">First Player</a></td><td>Walkover</td></tr>
    <tr><td>01.05.2025</td><td></td><td>WTA Open</td><td>Singles</td><td>Quarterfinal</td>
      <td><a href="player_page.php?player=999">Other Player</a></td><td>6-1,6-0</td></tr>
  </table>`;

test('official pair-specific WTA H2H counts only completed wins by the selected players', () => {
  assert.deepEqual(
    readOfficialH2HRecord(
      officialWtaH2hHtml,
      939,
      'First Player',
      944,
      'Second Player',
    ),
    { firstWins: 1, secondWins: 1, matches: 2 },
  );
});

test('official H2H refuses a page that did not select the requested player pair', () => {
  assert.equal(
    readOfficialH2HRecord(
      officialWtaH2hHtml,
      939,
      'First Player',
      945,
      'Different Player',
    ),
    null,
  );
});

test('an exact selected official pair with no results produces no fabricated meetings', () => {
  assert.deepEqual(
    readOfficialH2HRecord(
      '<option selected value="939">First</option><option selected value="944">Second</option>',
      939,
      'First Player',
      944,
      'Second Player',
    ),
    { firstWins: 0, secondWins: 0, matches: 0 },
  );
});
