import assert from 'node:assert/strict';
import test from 'node:test';
import { playScore, Te4DmoAnalysisError, Te4Replay } from '../lib/te4DmoParser.ts';

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
