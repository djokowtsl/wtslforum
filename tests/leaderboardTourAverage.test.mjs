import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateTourAverage,
  calculateTourMetricAverages,
  formatLeaderboardMetric,
  DEFAULT_LEADERBOARD_METRIC,
  resolveLeaderboardLeader,
} from '../lib/leaderboardTourAverage.mjs';

test('Serve is the default leaderboard metric when no metric is selected', () => {
  assert.equal(DEFAULT_LEADERBOARD_METRIC, 'serve');
});

test('leader spotlight uses the top screenshot-rating row and its player identity', () => {
  const leader = resolveLeaderboardLeader([
    {
      name: 'Serve Leader',
      wtsl_player_id: 'player-1',
      avatar_url: 'https://example.com/avatar.png',
      flag_url: 'https://example.com/flag.png',
      country: 'GBR',
      matches: 42,
      value: 9.4,
    },
    { name: 'Second Place', wtsl_player_id: 'player-2', matches: 40, value: 8.9 },
  ], true, true);

  assert.equal(leader.name, 'Serve Leader');
  assert.equal(leader.playerId, 'player-1');
  assert.equal(leader.avatarUrl, 'https://example.com/avatar.png');
  assert.equal(leader.flagUrl, 'https://example.com/flag.png');
  assert.equal(leader.row.value, 9.4);
});

test('leader spotlight supports unlinked aggregate players and official rows', () => {
  const screenshotLeader = resolveLeaderboardLeader([
    { player: 'Unlinked Player', wtslPlayerId: null, avatarUrl: null, matches: 25, value: 8.1 },
  ], true, false);
  assert.equal(screenshotLeader.name, 'Unlinked Player');
  assert.equal(screenshotLeader.playerId, null);

  const officialLeader = resolveLeaderboardLeader([
    { name: 'Official Leader', wtsl_player_id: 'player-3', avatar_url: 'avatar.jpg', matches: 31, wins: 27 },
  ], false, false);
  assert.equal(officialLeader.name, 'Official Leader');
  assert.equal(officialLeader.playerId, 'player-3');
  assert.equal(officialLeader.row.wins, 27);
  assert.equal(resolveLeaderboardLeader([], false, false), null);
});

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

test('all-metric averages use the official and screenshot leaderboard populations', () => {
  const averages = calculateTourMetricAverages(
    [{ wins: 12 }, { wins: 4 }],
    [
      { wtslPlayerId: 'player-1', metricValues: { serve: 8, bot_aces: 2 } },
      { wtslPlayerId: null, metricValues: { serve: 10, bot_aces: 4 } },
      { wtslPlayerId: 'player-2', metricValues: { serve: null, bot_aces: 6 } },
    ],
    [
      { key: 'wins', label: 'Wins', source: 'official', valueFormat: 'number' },
      { key: 'serve', label: 'Serve', source: 'screenshot', valueFormat: 'rating' },
      { key: 'bot_aces', label: 'Aces', source: 'screenshot', valueFormat: 'number' },
    ],
  );

  assert.deepEqual(averages.map(({ key, average }) => ({ key, average })), [
    { key: 'wins', average: { value: 8, playerCount: 2 } },
    { key: 'serve', average: { value: 8, playerCount: 1 } },
    { key: 'bot_aces', average: { value: 4, playerCount: 3 } },
  ]);
});

test('leaderboard metric values use consistent percentage, rating, and number formatting', () => {
  assert.equal(formatLeaderboardMetric(0.681, 'percent'), '68.1%');
  assert.equal(formatLeaderboardMetric(8.48, 'rating'), '8.5');
  assert.equal(formatLeaderboardMetric(1234.56), '1,234.6');
  assert.equal(formatLeaderboardMetric(null), '—');
});
