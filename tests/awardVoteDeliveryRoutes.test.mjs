import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { awardFormBallotFingerprint } from '../lib/awardVoteFormSync.ts';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const ballot = {
  season: '2026',
  updatedAt: '2026-10-22T10:00:00.000000Z',
  isComplete: true,
  answers: [{ category: 'Example award', answer: 'Example choice' }],
};
const fingerprint = awardFormBallotFingerprint(ballot.season, ballot.answers);

function loadRoute(adminRoute = false, options = {}) {
  const calls = { saves: [], queued: [], after: [], workers: [], receipts: [], synced: [], checks: [] };
  const mocks = {
    'next/server': {
      NextResponse: { json: (body, init) => Response.json(body, init) },
      after: (callback) => calls.after.push(callback),
    },
    '@/lib/auth': {
      getSession: async () => Object.hasOwn(options, 'user')
        ? options.user : { discordId: 'test-voter', isAdmin: true },
    },
    '@/lib/db': {
      sql: async () => [{ id: 1, cycle_id: 2, allow_write_in: true, voting_open: true }],
    },
    '@/lib/awardVoting': { isAwardVotingOpen: () => true },
    '@/lib/googleFormOptions': {},
    '@/lib/awards': {
      closeExpiredAwardCycles: async () => {},
      castVote: async (...args) => { calls.saves.push(args); return { id: 1 }; },
      getSiteAwardBallot: async () => options.ballot ?? ballot,
      saveAwardFormResponseState: async (...args) => {
        calls.receipts.push(args);
        return options.receiptConflict ? [] : [{ cycle_id: 2 }];
      },
    },
    '@/lib/awardVoteFormSync': {
      awardFormBallotFingerprint,
      checkAwardBallotFormResponse: async (...args) => {
        calls.checks.push(args);
        return options.check ?? {
          status: 'found', responseId: 'test-response', fingerprint, updatedAt: ballot.updatedAt,
        };
      },
    },
    '@/lib/awardFormSyncJobs': {
      enqueueAwardFormSyncJob: async (...args) => {
        calls.queued.push(args);
        return { id: '17', status: options.jobStatus ?? 'queued' };
      },
      processAwardFormSyncJob: async (...args) => calls.workers.push(args),
      markAwardFormSyncJobSynced: async (...args) => calls.synced.push(args),
      getAwardFormSyncJobById: async () => ({
        voterKey: 'test-voter', status: 'needs_review', desiredFingerprint: fingerprint,
      }),
    },
  };
  const path = adminRoute ? 'app/api/admin/awards/route.ts' : 'app/api/awards/vote/route.ts';
  const { code } = transformSync(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return { post: module.exports.POST, calls };
}

const request = (body) => new Request('https://forum.test/api/awards/vote', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const voteRequest = () => request({ categoryId: 1, nomineeId: 3 });
const checkRequest = () => request({ action: 'check-form-sync-job', cycleId: 2, jobId: '17' });

test('saving a completed ballot immediately schedules that ballot, without waiting for an admin batch', async () => {
  const { post, calls } = loadRoute();
  const response = await post(voteRequest());
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls.saves.length, 1);
  assert.deepEqual(calls.queued, [[2, 'test-voter', fingerprint, ballot.updatedAt]]);
  assert.equal(calls.after.length, 1);
  assert.equal(calls.workers.length, 0);
  await calls.after[0]();
  assert.deepEqual(calls.workers, [['17']]);
});

test('incomplete ballots remain saved without submitting, and guests cannot save', async () => {
  const incomplete = loadRoute(false, { ballot: { ...ballot, isComplete: false } });
  assert.deepEqual(await (await incomplete.post(voteRequest())).json(), { ok: true });
  assert.equal(incomplete.calls.saves.length, 1);
  assert.equal(incomplete.calls.queued.length, 0);
  const guest = loadRoute(false, { user: null });
  assert.equal((await guest.post(voteRequest())).status, 401);
  assert.equal(guest.calls.saves.length, 0);
});

test('saving again never automatically retries an uncertain submission', async () => {
  const { post, calls } = loadRoute(false, { jobStatus: 'needs_review' });
  assert.deepEqual(await (await post(voteRequest())).json(), { ok: true });
  assert.equal(calls.after.length, 0);
  assert.equal(calls.workers.length, 0);
});

test('guests and non-admin members cannot check private Form responses', async () => {
  for (const user of [null, { discordId: 'member', isAdmin: false }]) {
    const { post, calls } = loadRoute(true, { user });
    assert.equal((await post(checkRequest())).status, 403);
    assert.equal(calls.checks.length, 0);
    assert.equal(calls.receipts.length, 0);
  }
});

test('an exact existing receipt confirms the held job without sending or retrying a ballot', async () => {
  const { post, calls } = loadRoute(true);
  assert.deepEqual(await (await post(checkRequest())).json(), { ok: true, result: 'confirmed' });
  assert.deepEqual(calls.receipts, [[2, 'test-voter', 'test-response', fingerprint, ballot.updatedAt]]);
  assert.equal(calls.synced.length, 1);
  assert.equal(calls.queued.length + calls.workers.length + calls.after.length, 0);
});

test('absent, ambiguous and mismatching receipts never confirm or retry a ballot', async () => {
  for (const status of ['not_found', 'ambiguous', 'response_missing', 'unverifiable', 'unavailable', 'found']) {
    const { post, calls } = loadRoute(true, {
      check: { status, fingerprint: 'a'.repeat(64), responseId: 'other-response', updatedAt: ballot.updatedAt },
    });
    const result = await (await post(checkRequest())).json();
    assert.equal(result.result, status === 'found' ? 'response_mismatch' : status);
    assert.equal(calls.receipts.length + calls.synced.length + calls.queued.length + calls.workers.length, 0);
  }
});
