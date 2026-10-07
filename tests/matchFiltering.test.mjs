import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildImportedMatchSourceId,
  isPlaceholderPlayerName,
  orientScoreForPlayerOrder,
  scoreSignatureForPlayerOrder,
  unorderedScoreSignature,
} from '../lib/matchIdentity.ts';
import {
  deduplicateBettingBoardFixtures,
  filterUnconfirmedFixtures,
} from '../lib/fixture-order.ts';

test('stable import identity collapses mirrored rows and tournament aliases', () => {
  const firstScore = scoreSignatureForPlayerOrder([[6, 7], [3, 6]], false);
  const mirroredScore = scoreSignatureForPlayerOrder([[7, 6], [6, 3]], true);
  const first = buildImportedMatchSourceId({
    tour: 'TE4',
    tournamentKey: null,
    tournamentName: 'Tokyo ATP 500',
    round: null,
    playedAt: '2026-10-06',
    playerOneId: '20',
    playerTwoId: '4598',
    winnerId: '4598',
    scoreSignature: firstScore,
  });
  const mirrored = buildImportedMatchSourceId({
    tour: 'TE4',
    tournamentKey: null,
    tournamentName: 'Kinoshita Group Japan Open',
    round: 'Round of 32',
    playedAt: '2026-10-06 00:00:00',
    playerOneId: '4598',
    playerTwoId: '20',
    winnerId: '4598',
    scoreSignature: mirroredScore,
  });

  assert.equal(firstScore, '6-7 3-6');
  assert.equal(mirroredScore, firstScore);
  assert.equal(first, mirrored);
});

test('unordered score signature matches reversed-side duplicate result rows', () => {
  const firstSide = [[6, 7], [3, 6]];
  const secondSide = [[7, 6], [6, 3]];

  assert.notEqual(
    scoreSignatureForPlayerOrder(firstSide, false),
    scoreSignatureForPlayerOrder(firstSide, true),
  );
  assert.equal(unorderedScoreSignature(firstSide), '6-7 3-6');
  assert.equal(
    unorderedScoreSignature(secondSide),
    unorderedScoreSignature(firstSide),
  );
});

test('import identity keeps distinct events and match results separate', () => {
  const base = {
    tour: 'TE4_(F)',
    tournamentName: 'Tokyo',
    round: null,
    playedAt: '2026-10-06',
    playerOneId: '20',
    playerTwoId: '4598',
    winnerId: '4598',
    scoreSignature: '6-7 3-6',
  };
  assert.notEqual(
    buildImportedMatchSourceId({ ...base, tournamentKey: 'Tokyo_2026_TE4_(F)' }),
    buildImportedMatchSourceId({ ...base, tournamentKey: 'Osaka_2026_TE4_(F)' }),
  );
  assert.notEqual(
    buildImportedMatchSourceId({ ...base, tournamentKey: null }),
    buildImportedMatchSourceId({
      ...base,
      tournamentKey: null,
      scoreSignature: '6-4 6-3',
    }),
  );
});

test('recognizes placeholder player slots without matching normal names', () => {
  for (const name of ['TBC', 'T.B.C.', 'TBA', 'To be confirmed', '']) {
    assert.equal(isPlaceholderPlayerName(name), true, name);
  }
  assert.equal(isPlaceholderPlayerName('Squeaky'), false);
});

test('reorients set scores while preserving tiebreak notation', () => {
  assert.equal(orientScoreForPlayerOrder('7-6(6), 6-3', true), '6-7(6) 3-6');
});

test('removes unconfirmed fixtures from open and settled betting sections', () => {
  const real = { key: 'real', first_name: 'Squeaky', second_name: 'Maastodonte' };
  const fixtures = [
    real,
    { key: 'tbc', first_name: 'Squeaky', second_name: 'TBC' },
    { key: 'missing', first_name: 'Squeaky', second_name: null },
  ];
  assert.deepEqual(filterUnconfirmedFixtures(fixtures), [real]);
  assert.deepEqual(
    deduplicateBettingBoardFixtures(
      { open: fixtures, recent_settled: fixtures },
      [],
    ),
    { open: [real], recent_settled: [real] },
  );
});
