import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  awardFormBallotFingerprint,
  awardFormSyncStatus,
  syncAwardBallotsToForm,
} from '../lib/awardVoteFormSync.ts';

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

const ballot = {
  voterKey: 'discord-user-123',
  season: '2026',
  updatedAt: '2026-10-22T09:30:00.000123Z',
  answers: [
    { questionId: '12', category: 'Fans Favourite Award', answer: 'Dunlop' },
    { category: 'Best Dressed', answer: 'Dunlop' },
  ],
};

test('keeps Forum votes saved when native Form sync is not configured', async () => {
  await withEnvironment({}, async () => {
    assert.equal(awardFormSyncStatus(), 'not_configured');
    assert.deepEqual(await syncAwardBallotsToForm([ballot]), {
      status: 'not_configured',
      results: [],
      failed: 1,
    });
  });
});

test('posts complete ballots with a stable pseudonymous voter token, never a Discord ID', async () => {
  await withEnvironment({
    AWARDS_SHEET_WEB_APP_URL: 'https://script.google.com/macros/s/test-deployment/exec',
    AWARDS_SHEET_SYNC_SECRET: secret,
  }, async () => {
    const originalFetch = globalThis.fetch;
    let requestBody;
    const fingerprint = awardFormBallotFingerprint(ballot.season, ballot.answers);
    globalThis.fetch = async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        ok: true,
        results: [{
          voterToken: requestBody.ballots[0].voterToken,
          status: 'synced',
          responseId: 'native-response-1',
          fingerprint,
          updatedAt: ballot.updatedAt,
        }],
      }), { status: 200 });
    };
    try {
      assert.deepEqual(await syncAwardBallotsToForm([ballot]), {
        status: 'synced',
        results: [{
          voterKey: ballot.voterKey,
          status: 'synced',
          responseId: 'native-response-1',
          fingerprint,
          updatedAt: ballot.updatedAt,
        }],
        failed: 0,
      });
      assert.equal(requestBody.secret, secret);
      assert.equal(requestBody.ballots[0].season, '2026');
      assert.equal(requestBody.ballots[0].updatedAt, ballot.updatedAt);
      assert.equal(requestBody.ballots[0].fingerprint, fingerprint);
      assert.deepEqual(requestBody.ballots[0].answers, [
        { category: 'Best Dressed', answer: 'Dunlop' },
        { category: 'Fans Favourite Award', answer: 'Dunlop', questionId: '12' },
      ]);
      assert.equal(requestBody.ballots[0].voterToken, createHmac('sha256', secret).update('2026\0discord-user-123').digest('hex'));
      assert.equal(JSON.stringify(requestBody).includes(ballot.voterKey), false);
      assert.equal('voterKey' in requestBody.ballots[0], false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('rejects an untrusted endpoint, a short secret, or an incomplete ballot', async () => {
  await withEnvironment({
    AWARDS_SHEET_WEB_APP_URL: 'https://example.com/collect',
    AWARDS_SHEET_SYNC_SECRET: secret,
  }, async () => {
    assert.equal(awardFormSyncStatus(), 'misconfigured');
    assert.equal((await syncAwardBallotsToForm([ballot])).status, 'misconfigured');
  });

  await withEnvironment({
    AWARDS_SHEET_WEB_APP_URL: 'https://script.google.com/macros/s/test-deployment/exec',
    AWARDS_SHEET_SYNC_SECRET: 'too-short',
  }, async () => {
    assert.equal(awardFormSyncStatus(), 'misconfigured');
  });

  await withEnvironment({
    AWARDS_SHEET_WEB_APP_URL: 'https://script.google.com/macros/s/test-deployment/exec',
    AWARDS_SHEET_SYNC_SECRET: secret,
  }, async () => {
    const incomplete = { ...ballot, answers: [] };
    assert.equal((await syncAwardBallotsToForm([incomplete])).status, 'failed');
  });
});

test('reports bridge rejection without discarding the Forum ballot', async () => {
  await withEnvironment({
    AWARDS_SHEET_WEB_APP_URL: 'https://script.google.com/macros/s/test-deployment/exec',
    AWARDS_SHEET_SYNC_SECRET: secret,
  }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false }), { status: 200 });
    try {
      assert.deepEqual(await syncAwardBallotsToForm([ballot]), {
        status: 'failed',
        results: [{ voterKey: ballot.voterKey, status: 'failed' }],
        failed: 1,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
