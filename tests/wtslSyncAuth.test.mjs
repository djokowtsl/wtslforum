import assert from 'node:assert/strict';
import test from 'node:test';
import { isWtslSyncAuthorized } from '../lib/wtslSyncAuth.ts';

test('WTSL sync auth accepts configured external and Vercel cron secrets only', () => {
  const secrets = {
    externalSecret: 'test-wtsl-sync-secret',
    cronSecret: 'test-cron-secret',
  };

  assert.equal(
    isWtslSyncAuthorized(
      new Headers({ 'x-wtsl-sync-secret': 'test-wtsl-sync-secret' }),
      secrets,
    ),
    true,
  );
  assert.equal(
    isWtslSyncAuthorized(
      new Headers({ authorization: 'Bearer test-cron-secret' }),
      secrets,
    ),
    true,
  );
  assert.equal(
    isWtslSyncAuthorized(
      new Headers({ 'x-wtsl-sync-secret': 'wrong' }),
      secrets,
    ),
    false,
  );
  assert.equal(isWtslSyncAuthorized(new Headers(), {}), false);
});
