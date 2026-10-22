import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  awardFormBallotFingerprint,
  checkAwardBallotFormResponse,
} from '../lib/awardVoteFormSync.ts';

const secret = 'forum-awards-sync-secret-for-tests-123456';
const ballot = {
  voterKey: 'discord-user-123',
  season: '2026',
  updatedAt: '2026-10-22T09:30:00.000123Z',
  answers: [
    { questionId: '12', category: 'Fans Favourite Award', answer: 'Dunlop' },
    { category: 'Best Dressed', answer: 'Dunlop' },
  ],
};

async function withConfiguration(run) {
  const keys = ['AWARDS_SHEET_WEB_APP_URL', 'AWARDS_SHEET_SYNC_SECRET'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.AWARDS_SHEET_WEB_APP_URL = 'https://script.google.com/macros/s/test-deployment/exec';
  process.env.AWARDS_SHEET_SYNC_SECRET = secret;
  try {
    await run();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('response lookup sends only a pseudonymous token and validates the Form receipt', async () => {
  await withConfiguration(async () => {
    const originalFetch = globalThis.fetch;
    let requestBody;
    globalThis.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        ok: true,
        result: {
          status: 'found',
          responseId: 'native_response_1',
          fingerprint: awardFormBallotFingerprint(ballot.season, ballot.answers),
          updatedAt: ballot.updatedAt,
        },
      }), { status: 200 });
    };

    try {
      const result = await checkAwardBallotFormResponse(ballot);
      assert.equal(result.status, 'found');
      assert.equal(result.responseId, 'native_response_1');
      assert.equal(requestBody.action, 'check-response');
      assert.equal(
        requestBody.voterToken,
        createHmac('sha256', secret).update('2026\0discord-user-123').digest('hex'),
      );
      assert.equal('voterKey' in requestBody, false);
      assert.equal('answers' in requestBody, false);
      assert.equal('responseId' in requestBody, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('missing and unavailable Form checks do not become resubmission requests', async () => {
  await withConfiguration(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: true,
      result: { status: 'not_found' },
    }), { status: 200 });
    try {
      assert.deepEqual(await checkAwardBallotFormResponse(ballot), { status: 'not_found' });
      globalThis.fetch = async () => { throw new Error('private transport detail'); };
      assert.deepEqual(await checkAwardBallotFormResponse(ballot), { status: 'unavailable' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
