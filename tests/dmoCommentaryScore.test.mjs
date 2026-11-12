import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDmoCommentaryScoreReply,
  buildDmoPointCommentary,
  dmoPressureAfterPoint,
  isDmoGameEnding,
  summarizeDmoCommentaryStats,
  withDmoCommentaryHistory,
} from '../lib/dmoCommentary.mjs';

const booth = ['gifu', 'Debuffy'];

test('recorded scores distinguish break, set, match, and ordinary game points', () => {
  assert.match(buildDmoPointCommentary({
    number: 5, winner: 2, server: 1, rallyHits: 3,
    scoreBeforeLabel: '1-1(15-30)', scoreAfterLabel: '1-1(15-40)',
  }, booth), /two break points/i);
  assert.match(buildDmoPointCommentary({
    number: 5, winner: 2, server: 1, rallyHits: 3,
    scoreBeforeLabel: '4-5(40-40)', scoreAfterLabel: '4-5(40-AD)',
  }, booth), /^(?=.*Debuffy)(?=.*\bset point\b)(?!.*match)/i);
  assert.match(buildDmoPointCommentary({
    number: 90, winner: 1, server: 1, rallyHits: 3,
    scoreBeforeLabel: '5-3(30-30)', scoreAfterLabel: '5-3(40-30)',
    setsWonBefore: [1, 0], setsToWin: 2,
  }, booth), /^(?=.*gifu)(?=.*match point)/i);
  assert.match(buildDmoPointCommentary({
    number: 90, winner: 1, server: 1, rallyHits: 3,
    scoreBeforeLabel: '5-3(30-30)', scoreAfterLabel: '5-3(40-30)',
  }, booth), /^(?=.*gifu)(?=.*\bset point\b)(?!.*match)/i);
  assert.equal(buildDmoPointCommentary({
    number: 4, winner: 1, server: 1, rallyHits: 3,
    scoreBeforeLabel: '1-1(30-15)', scoreAfterLabel: '1-1(40-15)',
  }, booth), '');
});

test('tie-break pressure and point reactions are based on the recorded score', () => {
  assert.equal(dmoPressureAfterPoint({
    number: 70, winner: 1, server: 2, isTiebreak: true,
    scoreBeforeLabel: '6-6(5-3)', scoreAfterLabel: '6-6(6-3)',
  })?.count, 3);
  const line = buildDmoPointCommentary({
    number: 71, winner: 2, server: 1, rallyHits: 12,
    scoreBeforeLabel: '2-2(30-30)', scoreAfterLabel: '2-2(30-40)',
  }, booth);
  assert.match(line, /Debuffy/);
  assert.match(line, /break point/i);
});

test('a verified match end receives a complete result and final score reply', () => {
  const point = withDmoCommentaryHistory({
    number: 120, winner: 2, server: 2, rallyHits: 4, matchOver: true,
    scoreBeforeLabel: '5-4(40-15)', setBefore: 3, setsWonBefore: [1, 1], setsToWin: 2,
    finalSets: [[6, 4], [3, 6], [4, 6]],
  }, []);
  assert.equal(isDmoGameEnding(point), true);
  assert.match(buildDmoPointCommentary(point, booth), /match/i);
  assert.match(buildDmoPointCommentary(point, booth), /Debuffy/);
  assert.match(buildDmoCommentaryScoreReply({ names: booth, point }), /four-six, six-three, six-four/);
  assert.equal(isDmoGameEnding({ ...point, inferred: true }), false);
});

test('the second voice gives the set score only when it is verified', () => {
  const point = {
    number: 60, winner: 2, server: 2, rallyHits: 2,
    scoreBeforeLabel: '5-4(40-0)', scoreAfterLabel: '0-0(0-0)',
    setBefore: 1, setAfter: 2, setsWonBefore: [0, 0], setsToWin: 2,
  };
  assert.match(buildDmoCommentaryScoreReply({ names: booth, point }), /Debuffy.*one set to love/);
  assert.match(buildDmoCommentaryScoreReply({
    names: booth, point: { ...point, setBefore: 2, setAfter: 3, setsWonBefore: [1, 0] },
  }), /one set (all|each|apiece)/);
  assert.equal(buildDmoCommentaryScoreReply({
    names: booth, point: { ...point, setsWonBefore: undefined },
  }), '');
});

function gameEnd(number, winner, server, before, after) {
  return { number, winner, server, rallyHits: 3, scoreBeforeLabel: before, scoreAfterLabel: after };
}

test('break-back and consolidation calls use the immediately previous game', () => {
  const history = [gameEnd(1, 2, 1, '0-0(30-40)', '0-1(0-0)')];
  const breakBack = withDmoCommentaryHistory(
    gameEnd(2, 1, 2, '0-1(40-30)', '1-1(0-0)'), history,
  );
  assert.match(buildDmoPointCommentary(breakBack, booth), /breaks? (straight )?back|hits back/);
  const consolidate = withDmoCommentaryHistory(
    gameEnd(2, 2, 2, '0-1(30-40)', '0-2(0-0)'), history,
  );
  assert.match(buildDmoPointCommentary(consolidate, booth), /consolidat|backs up the break/);
  const gap = withDmoCommentaryHistory(
    gameEnd(3, 2, 2, '0-1(30-40)', '0-2(0-0)'), history,
  );
  assert.equal(gap.previousGame, null);
});

test('game streaks are spoken only when the full run is known', () => {
  const history = [
    gameEnd(1, 1, 1, '0-0(40-0)', '1-0(0-0)'),
    gameEnd(2, 1, 2, '1-0(40-30)', '2-0(0-0)'),
  ];
  const third = withDmoCommentaryHistory(
    gameEnd(3, 1, 1, '2-0(40-15)', '3-0(0-0)'), history,
  );
  assert.equal(third.gameStreak, 3);
  assert.match(buildDmoPointCommentary(third, booth), /three/i);
  const partial = withDmoCommentaryHistory(
    gameEnd(9, 1, 1, '5-0(40-15)', '6-0(0-0)'),
    [gameEnd(8, 1, 2, '4-0(30-40)', '5-0(0-0)')],
  );
  assert.equal(partial.gameStreak, null);
});

test('long matches reuse older calls instead of going silent', () => {
  const point = { number: 12, winner: 1, server: 1, rallyHits: 14 };
  const recent = [];
  for (let index = 0; index < 30; index += 1) {
    const line = buildDmoPointCommentary({ ...point, number: point.number + index }, booth, recent);
    assert.ok(line, `call ${index} is not silent`);
    recent.unshift(line);
  }
});

test('match totals count only points supplied to the summary', () => {
  assert.deepEqual(summarizeDmoCommentaryStats([
    { winner: 1, server: 1 }, { winner: 2, server: 1 }, { winner: 2, server: 2 },
    { winner: 1, server: 2, inferred: true },
  ]), [
    { pointsWon: 1, servicePoints: 2, servicePointsWon: 1 },
    { pointsWon: 2, servicePoints: 1, servicePointsWon: 1 },
  ]);
});
