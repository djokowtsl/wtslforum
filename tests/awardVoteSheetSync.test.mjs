import test from 'node:test';
import assert from 'node:assert/strict';
import {
  awardVoteSheetSyncStatus,
  syncAwardVotesToSheet,
} from '../lib/awardVoteSheetSync.ts';

const secret = 'forum-awards-sync-secret-for-tests-123456';

function withEnvironment(values, run) {
  const keys = ['AWARDS_SHEET_WEB_APP_URL', 'AWARDS_SHEET_SYNC_SECRET'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

const vote = {
  voteId: '42',
  season: '2026',
  category: 'Fans Favourite Award',
  nominee: 'Dunlop',
  writeIn: null,
  castAt: '2026-10-22T09:30:00.000Z',
  voterKey: 'must-not-be-exported',
};

test('keeps vote submission successful while sync is not configured', async () => {
  await withEnvironment({}, async () => {
    assert.equal(awardVoteSheetSyncStatus(), 'not_configured');
    assert.deepEqual(await syncAwardVotesToSheet([vote]), {
      status: 'not_configured',
      synced: 0,
      failed: 1,
    });
  });
});

test('posts only privacy-limited vote fields to a valid Apps Script endpoint', async () => {
  await withEnvironment({
    AWARDS_SHEET_WEB_APP_URL: 'https://script.google.com/macros/s/test-deployment/exec',
    AWARDS_SHEET_SYNC_SECRET: secret,
  }, async () => {
    const originalFetch = globalThis.fetch;
    let requestBody;
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    try {
      assert.deepEqual(await syncAwardVotesToSheet([vote]), {
        status: 'synced',
        synced: 1,
        failed: 0,
      });
      assert.equal(requestBody.secret, secret);
      assert.deepEqual(requestBody.votes[0], {
        voteId: '42',
        season: '2026',
        category: 'Fans Favourite Award',
        nominee: 'Dunlop',
        writeIn: null,
        castAt: '2026-10-22T09:30:00.000000Z',
      });
      assert.equal('voterKey' in requestBody.votes[0], false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('rejects an untrusted endpoint or a short shared secret', async () => {
  await withEnvironment({
    AWARDS_SHEET_WEB_APP_URL: 'https://example.com/collect',
    AWARDS_SHEET_SYNC_SECRET: secret,
  }, async () => {
    assert.equal(awardVoteSheetSyncStatus(), 'misconfigured');
    assert.equal((await syncAwardVotesToSheet([vote])).status, 'misconfigured');
  });

  await withEnvironment({
    AWARDS_SHEET_WEB_APP_URL: 'https://script.google.com/macros/s/test-deployment/exec',
    AWARDS_SHEET_SYNC_SECRET: 'too-short',
  }, async () => {
    assert.equal(awardVoteSheetSyncStatus(), 'misconfigured');
  });
});

test('reports a bridge rejection without throwing away the saved vote', async () => {
  await withEnvironment({
    AWARDS_SHEET_WEB_APP_URL: 'https://script.google.com/macros/s/test-deployment/exec',
    AWARDS_SHEET_SYNC_SECRET: secret,
  }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false }), { status: 200 });
    try {
      assert.deepEqual(await syncAwardVotesToSheet([vote]), {
        status: 'failed',
        synced: 0,
        failed: 1,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
