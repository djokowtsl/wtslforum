import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const voteRoute = read('../app/api/awards/vote/route.ts');
const jobs = read('../lib/awardFormSyncJobs.ts');
const migration = read('../migrations/2026-10-22-award-form-sync-jobs.sql');
const playerForm = read('../components/AwardVoteForm.tsx');
const adminForm = read('../components/AwardAdminPanel.tsx');
const adminRoute = read('../app/api/admin/awards/route.ts');

test('complete ballot saves enqueue work and return without awaiting the Form bridge', () => {
  assert.match(voteRoute, /enqueueAwardFormSyncJob/);
  assert.match(voteRoute, /after\(async \(\) =>/);
  assert.doesNotMatch(voteRoute, /syncAwardBallotsToForm/);
  assert.doesNotMatch(voteRoute, /formSyncStatus|ballotSubmitted/);
});

test('ambiguous bridge outcomes require review rather than an automatic retry', () => {
  const retryCodes = jobs.match(/const SAFE_RETRY_CODES = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
  assert.match(retryCodes, /sync_lock_failed/);
  assert.doesNotMatch(retryCodes, /bridge_unreachable|form_response_submission_failed|response_metadata_write_failed/);
  assert.match(jobs, /'needs_review'/);
  assert.match(migration, /'needs_review'/);
});

test('voters see only the Forum save confirmation, never external Form sync status', () => {
  assert.match(playerForm, /Your current vote is saved\./);
  assert.doesNotMatch(playerForm, /\/api\/awards\/vote-status|Ballot submitted|submission is being checked|submission is processing|Please don’t resubmit/);
  assert.equal(existsSync(new URL('../app/api/awards/vote-status/route.ts', import.meta.url)), false);
  assert.doesNotMatch(voteRoute, /formSyncStatus|ballotSubmitted/);
  assert.doesNotMatch(playerForm, /Please try again later/);
});

test('admin can check held jobs without returning ballot identifiers or answer data', () => {
  assert.match(adminForm, /Needs review:/);
  assert.match(adminForm, /Retry safe failures/);
  assert.match(adminForm, /Check existing response/);
  assert.match(adminRoute, /action === 'check-form-sync-job'/);
  assert.match(adminRoute, /checkAwardBallotFormResponse/);
  assert.match(adminRoute, /if \(!admin\)/);
  assert.match(jobs, /getAwardFormSyncJobById/);
  const summaryBlock = jobs
    .split('export async function getAwardFormSyncSummary')[1]
    ?.split('export async function retrySafeAwardFormSyncJobs')[0] ?? '';
  assert.doesNotMatch(summaryBlock, /voter_key|voterKey|answers/);
  const checkResponseBlock = adminRoute
    .split("if (action === 'check-form-sync-job')")[1]
    ?.split("if (action === 'retry-safe-form-sync-jobs')")[0] ?? '';
  const apiResponseLines = checkResponseBlock
    .split('\n')
    .filter((line) => line.includes('return NextResponse.json'))
    .join('\n');
  assert.doesNotMatch(apiResponseLines, /voterKey|responseId|answers/);
});
