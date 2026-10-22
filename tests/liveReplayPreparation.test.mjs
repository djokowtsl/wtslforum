import assert from 'node:assert/strict';
import test from 'node:test';
import { attemptFullReplayPreparation } from '../lib/liveReplayPreparation.ts';

test('a failed full replay enhancement leaves the basic replay available', async () => {
  let attempted = false;
  const prepared = await attemptFullReplayPreparation(async () => {
    attempted = true;
    throw new Error('private replay storage unavailable');
  });

  assert.equal(attempted, true);
  assert.equal(prepared, false);
});

test('successful full replay preparation enables the analyzer player', async () => {
  const prepared = await attemptFullReplayPreparation(async () => undefined);
  assert.equal(prepared, true);
});
