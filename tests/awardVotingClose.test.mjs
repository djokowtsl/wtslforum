import assert from 'node:assert/strict';
import test from 'node:test';
import { isAwardVotingOpen } from '../lib/awardVoting.ts';

const now = Date.parse('2026-10-22T12:00:00.000Z');

test('manual open state remains the primary voting switch', () => {
  assert.equal(isAwardVotingOpen(false, null, now), false);
  assert.equal(isAwardVotingOpen(true, null, now), true);
});

test('a future close date allows votes, while the exact deadline closes voting', () => {
  assert.equal(isAwardVotingOpen(true, '2026-10-22T12:00:01.000Z', now), true);
  assert.equal(isAwardVotingOpen(true, '2026-10-22T12:00:00.000Z', now), false);
  assert.equal(isAwardVotingOpen(true, '2026-10-22T11:59:59.000Z', now), false);
});

test('an invalid configured close date fails closed', () => {
  assert.equal(isAwardVotingOpen(true, 'not-a-date', now), false);
});
