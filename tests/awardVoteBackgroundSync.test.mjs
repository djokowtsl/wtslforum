import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const voteRoute = read('../app/api/awards/vote/route.ts');
const statusRoute = read('../app/api/awards/vote-status/route.ts');
const jobs = read('../lib/awardFormSyncJobs.ts');
const migration = read('../migrations/2026-10-22-award-form-sync-jobs.sql');
const playerForm = read('../components/AwardVoteForm.tsx');
const adminForm = read('../components/AwardAdminPanel.tsx');

test('complete ballot saves enqueue work and return without awaiting the Form bridge', () => {
  assert.match(voteRoute, /enqueueAwardFormSyncJob/);
  assert.match(voteRoute, /after\(async \(\) =>/);
  assert.doesNotMatch(voteRoute, /syncAwardBallotsToForm/);
  assert.match(voteRoute, /formSyncStatus: job\.status === 'needs_review' \? 'needs_review' : 'queued'/);
});

test('ambiguous bridge outcomes require review rather than an automatic retry', () => {
  const retryCodes = jobs.match(/const SAFE_RETRY_CODES = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
  assert.match(retryCodes, /sync_lock_failed/);
  assert.doesNotMatch(retryCodes, /bridge_unreachable|form_response_submission_failed|response_metadata_write_failed/);
  assert.match(jobs, /'needs_review'/);
  assert.match(migration, /'needs_review'/);
});

test('players can see in-place pending and confirmation states without being told to resubmit', () => {
  assert.match(playerForm, /\/api\/awards\/vote-status/);
  assert.match(playerForm, /Ballot submitted/);
  assert.match(playerForm, /Please don’t resubmit/);
  assert.doesNotMatch(playerForm, /Please try again later/);
  assert.match(statusRoute, /getSession\(\)/);
});

test('admin sync status uses aggregate counts and does not include voter answers or identifiers', () => {
  assert.match(adminForm, /Needs review:/);
  assert.match(adminForm, /Retry safe failures/);
  const summaryBlock = jobs
    .split('export async function getAwardFormSyncSummary')[1]
    ?.split('export async function retrySafeAwardFormSyncJobs')[0] ?? '';
  assert.doesNotMatch(summaryBlock, /voter_key|voterKey|answers/);
});
