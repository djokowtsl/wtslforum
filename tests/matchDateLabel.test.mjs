import assert from 'node:assert/strict';
import test from 'node:test';
import { matchDateLabel, timeAgo } from '../lib/format.ts';

test('date-only results use calendar labels instead of elapsed hours', () => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterdayDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const yesterday = yesterdayDate.toISOString().slice(0, 10);

  assert.equal(matchDateLabel(today), 'Today');
  assert.equal(matchDateLabel(yesterday), 'Yesterday');
  assert.equal(matchDateLabel('2020-01-02'), '2 Jan 2020');
});

test('timestamped results retain the existing relative-time behavior', () => {
  const timestamp = new Date(Date.now() - 5 * 60_000).toISOString();
  assert.equal(matchDateLabel(timestamp), timeAgo(timestamp));
});
