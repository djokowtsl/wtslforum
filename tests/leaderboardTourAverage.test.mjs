import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateTourAverage } from '../lib/leaderboardTourAverage.mjs';

test('official result averages use the selected leaderboard metric and count numeric rows', () => {
  const result = calculateTourAverage([
    { wins: 12, win_pct: 60, tour_elo: 1040 },
    { wins: 8, win_pct: 40, tour_elo: 960 },
    { wins: 4, win_pct: null, tour_elo: null },
  ], 'win_pct', false);

  assert.deepEqual(result, { value: 50, playerCount: 2 });
});

test('screenshot averages use the selected screenshot metric value', () => {
  const result = calculateTourAverage([
    { value: 142.5, aces: 7 },
    { value: 157.5, aces: 12 },
  ], 'bot_avg_1st_serve_speed', true);

  assert.deepEqual(result, { value: 150, playerCount: 2 });
});

test('measured screenshot zeroes remain valid while null measurements are excluded', () => {
  const result = calculateTourAverage([
    { value: 0 },
    { value: 10 },
    { value: null },
  ], 'bot_aces', true);

  assert.deepEqual(result, { value: 5, playerCount: 2 });
});

test('all-zero official measured statistics are unavailable rather than reported as tour averages', () => {
  assert.equal(calculateTourAverage([
    { aces: 0 },
    { aces: 0 },
  ], 'aces', false), null);
});
