import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlayerSeasonHighlights } from '../lib/playerSeasonHighlights.ts';
import { parseWTSLWtaMatchResultsCsv } from '../lib/wtslSeasonResults.ts';

const csv = [
  'Game,Tour,Player 1,Player 2,Competition,Result,Date,Tournament,Round',
  'Tennis Elbow 4,Tennis Elbow 4 (WTA Characters), Aster ,Birch,Singles,6-0 6-0,01.01.2026,"Tennis Elbow 4 (WTA Characters) Main, Event",First Round',
  'Tennis Elbow 4,Tennis Elbow 4 (WTA Characters),Aster,Cedar,Singles,6-4 6-0,01.01.2026,"Tennis Elbow 4 (WTA Characters) Main, Event",Quarter-Final',
  'Tennis Elbow 4,Tennis Elbow 4 (WTA Characters),Aster,Dana,Singles,6-2 6-4,01.01.2026,"Tennis Elbow 4 (WTA Characters) Main, Event",Semi-Final',
  'Tennis Elbow 4,Tennis Elbow 4 (WTA Characters),Elise,Aster,Singles,6-4 6-3,01.01.2026,"Tennis Elbow 4 (WTA Characters) Main, Event",Final',
  'Tennis Elbow 4,Tennis Elbow 4 (WTA Characters),Aster,Birch,Singles,6-0 6-0,02.01.2026,Tennis Elbow 4 (WTA Characters) Losers Event,Losers Final',
  'Tennis Elbow 4,Tennis Elbow 4 (WTA Characters),Aster,Fern,Singles,Walkover,02.01.2026,Tennis Elbow 4 (WTA Characters) Walkover Event,Second Round',
  'Tennis Elbow 4,Tennis Elbow 4 (WTA Characters),Aster,Gia,Singles,1-0,02.01.2026,Tennis Elbow 4 (WTA Characters) Incomplete Event,First Round',
  'Tennis Elbow 4,Tennis Elbow 4 (WTA Characters),Aster,Hera,Singles,3-0 ret.,02.01.2026,Tennis Elbow 4 (WTA Characters) Losers Event,Losers Round 2',
  'Tennis Elbow 4,Tennis Elbow 4 (WTA Characters),Aster & Birch,Cedar & Dana,Doubles,6-0 6-0,02.01.2026,Tennis Elbow 4 (WTA Characters) Doubles Event,Final',
  'Tennis Elbow 4,Tennis Elbow 4 (ATP Characters),Aster,Birch,Singles,6-0 6-0,02.01.2026,Tennis Elbow 4 (ATP Characters) ATP Event,Final',
].join('\n');

test('the WTA results CSV maps singles to the WTA tour and preserves quoted commas', () => {
  const rows = parseWTSLWtaMatchResultsCsv(csv);
  assert.equal(rows.length, 8);
  assert.equal(rows[0].tour, 'TE4_(F)');
  assert.equal(rows[0].p1, 'Aster');
  assert.equal(rows[0].tournament, 'Tennis Elbow 4 (WTA Characters) Main, Event');
  assert.ok(rows.every((row) => row.tour === 'TE4_(F)' && row.event_category === 'Singles'));
});

test('season highlights count scored matches but exclude losers-bracket finals from achievements', () => {
  const rows = parseWTSLWtaMatchResultsCsv(csv);
  const highlights = buildPlayerSeasonHighlights(rows, 'Aster', 'TE4_(F)', 2026, '939');
  assert.deepEqual(
    { matches: highlights.matches, wins: highlights.wins, losses: highlights.losses },
    { matches: 6, wins: 5, losses: 1 },
  );
  assert.deepEqual(highlights.titles, []);
  assert.deepEqual(highlights.runnerUps, ['Main, Event']);
  assert.equal(highlights.finalsReached, 1);
  assert.deepEqual(highlights.bestRuns, [{ tournament: 'Main, Event', round: 'Final' }]);
});
