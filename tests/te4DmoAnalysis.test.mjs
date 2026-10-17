import assert from 'node:assert/strict';
import test from 'node:test';
import { playScore, Te4DmoAnalysisError, Te4Replay } from '../lib/te4DmoParser.ts';
import {
  buildTe4CoachingSummary,
  defaultTe4CoachingPlayer,
  listTe4CoachingPlayers,
} from '../lib/te4DmoCoaching.ts';

test('TE4 score reconstruction handles a straight-set match', () => {
  const points = [];
  for (let game = 0; game < 10; game += 1) {
    const winner = game < 8 ? (game % 2 === 0 ? 1 : 2) : 1;
    for (let point = 0; point < 4; point += 1) points.push([winner, 1]);
  }
  const result = playScore(points);
  assert.deepEqual(result.sets, [[6, 4]]);
  assert.deepEqual(result.games, [0, 0]);
  assert.deepEqual(result.points, [0, 0]);
  assert.equal(result.rows.length, 40);
});

test('TE4 score reconstruction marks and closes a deciding tiebreak', () => {
  const points = [];
  for (let game = 0; game < 12; game += 1) {
    const winner = game % 2 === 0 ? 1 : 2;
    for (let point = 0; point < 4; point += 1) points.push([winner, 1]);
  }
  for (let i = 0; i < 6; i += 1) points.push([1, 1]);
  for (let i = 0; i < 6; i += 1) points.push([2, 1]);
  points.push([1, 1], [1, 1]);

  const result = playScore(points);
  assert.deepEqual(result.sets, [[7, 6]]);
  assert.equal(result.rows.at(-1).tiebreak, true);
  assert.equal(result.rows.at(-1).points, '7-6');
});

test('unsupported or truncated DMO inputs fail explicitly', () => {
  assert.throws(
    () => new Te4Replay(Buffer.alloc(0)),
    (error) => error instanceof Te4DmoAnalysisError && /not a supported TE4/i.test(error.message),
  );
});

test('coaching combines only matches with the selected named player and reports evidence counts', () => {
  const makePoint = (server, winner, { faults = 0, hits = 0, lastShotPlayer = winner } = {}) => ({
    s: server,
    w: winner,
    f: faults,
    n: hits,
    sh: hits ? [{ p: lastShotPlayer }] : [{ p: server }],
  });
  const makeResult = (names, finalWinner, pts) => ({
    names,
    meta: { finalWinner },
    viewer: { pts },
  });
  const firstMatch = makeResult(
    ['Avery', 'Opponent 1'],
    1,
    [
      ...Array.from({ length: 10 }, (_, index) => makePoint(1, index < 7 ? 1 : 2)),
      ...Array.from({ length: 10 }, (_, index) => makePoint(2, index < 4 ? 1 : 2)),
      ...Array.from({ length: 8 }, (_, index) => makePoint(1, index < 3 ? 1 : 2, {
        hits: 8,
        lastShotPlayer: 1,
      })),
    ],
  );
  const secondMatch = makeResult(
    ['Avery', 'Opponent 2'],
    2,
    [
      ...Array.from({ length: 10 }, (_, index) => makePoint(1, index < 6 ? 1 : 2)),
      ...Array.from({ length: 10 }, (_, index) => makePoint(2, index < 3 ? 1 : 2)),
    ],
  );
  const unrelatedMatch = makeResult(
    ['Other Player', 'Opponent 3'],
    1,
    Array.from({ length: 20 }, () => makePoint(1, 1)),
  );

  assert.deepEqual(listTe4CoachingPlayers([firstMatch, secondMatch, unrelatedMatch]), [
    'Avery',
    'Opponent 1',
    'Opponent 2',
    'Opponent 3',
    'Other Player',
  ]);
  assert.equal(defaultTe4CoachingPlayer([firstMatch, secondMatch]), 'Avery');

  const summary = buildTe4CoachingSummary(
    [firstMatch, secondMatch, unrelatedMatch],
    'Avery',
  );
  assert.equal(summary.matchesAnalyzed, 3);
  assert.equal(summary.matchesWithPlayer, 2);
  assert.equal(summary.matchWins, 1);
  assert.equal(summary.stats.servicePoints, 28);
  assert.equal(summary.stats.servicePointsWon, 16);
  assert.equal(summary.stats.returnPoints, 20);
  assert.equal(summary.stats.returnPointsWon, 7);
  assert.equal(summary.stats.longRallyPoints, 8);
  assert.ok(summary.insights.some((insight) => /long rallies/i.test(insight.title)));
  assert.ok(summary.insights.every((insight) => insight.evidence.length > 0 && insight.cue.length > 0));
});

test('coaching does not combine generic player placeholders or invent insights from empty samples', () => {
  const genericResult = {
    names: ['Player 1', 'Player 2'],
    meta: { finalWinner: 1 },
    viewer: { pts: [] },
  };
  assert.deepEqual(listTe4CoachingPlayers([genericResult]), []);
  assert.equal(defaultTe4CoachingPlayer([genericResult]), null);

  const summary = buildTe4CoachingSummary([genericResult], '');
  assert.equal(summary.matchesWithPlayer, 0);
  assert.deepEqual(summary.insights, []);
});
