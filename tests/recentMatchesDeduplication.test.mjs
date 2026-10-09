import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const statsSource = await readFile(new URL('../lib/stats.ts', import.meta.url), 'utf8');
const bettingSource = await readFile(new URL('../lib/betting.ts', import.meta.url), 'utf8');
const coreSource = await readFile(new URL('../lib/wtsl-core.ts', import.meta.url), 'utf8');
const publicFeedsSource = await readFile(new URL('../components/PublicLiveData.tsx', import.meta.url), 'utf8');
const snapshotStoreSource = await readFile(new URL('../lib/siteSnapshots.ts', import.meta.url), 'utf8');
const snapshotSyncSource = await readFile(new URL('../app/api/sync/public-page-snapshots/route.ts', import.meta.url), 'utf8');
const recentMatchesQuery = statsSource.match(
  /export async function recentMatches[\s\S]*?(?=\nexport |\s*$)/,
)?.[0];

assert.ok(recentMatchesQuery, 'recentMatches query should be present');

test('official recent results suppress imported duplicates across one date boundary', () => {
  const shadowingCte = recentMatchesQuery.match(
    /imported_matches_shadowed_by_official AS \([\s\S]*?\), ranked_match_rows AS/,
  )?.[0];

  assert.ok(shadowingCte, 'query should identify imported rows shadowed by official results');
  assert.match(shadowingCte, /imported\.source_id[\s\S]*LIKE 'import:%'/);
  assert.match(shadowingCte, /official\.source_id[\s\S]*LIKE 'recent:%'/);
  assert.match(shadowingCte, /official\.tour=imported\.tour/);
  assert.match(shadowingCte, /LEAST\(official\.player_one_id::text, official\.player_two_id::text\)[\s\S]*LEAST\(imported\.player_one_id::text, imported\.player_two_id::text\)/);
  assert.match(shadowingCte, /GREATEST\(official\.player_one_id::text, official\.player_two_id::text\)[\s\S]*GREATEST\(imported\.player_one_id::text, imported\.player_two_id::text\)/);
  assert.match(shadowingCte, /official\.unordered_score_signature=imported\.unordered_score_signature/);
  assert.match(shadowingCte, /official\.played_at::date <> imported\.played_at::date/);
  assert.match(shadowingCte, /ABS\(official\.played_at::date - imported\.played_at::date\) = 1/);
  assert.match(recentMatchesQuery, /WHERE NOT EXISTS \([\s\S]*imported_matches_shadowed_by_official shadowed/);
});

test('the public WTSL results query excludes imported screenshot and TE4-post rows', () => {
  assert.match(
    recentMatchesQuery,
    /source: 'all' \| 'wtsl' = 'all'/,
  );
  assert.match(
    recentMatchesQuery,
    /AND \(\$\{source !== 'wtsl'\} OR COALESCE\(m\.source_id, ''\) LIKE 'recent:%'\)/,
  );
  assert.match(statsSource, /recentMatches\(fallbackLimit, tour, 'wtsl'\)/);
  assert.match(statsSource, /Promise\.allSettled\(\[\s*profileRowsPromise,\s*wtslCoreResultsInFlight\(\)/);
  assert.match(statsSource, /profileResult\.status === 'rejected' && coreResult\.status === 'rejected'/);
  assert.match(statsSource, /wtslCoreResultsInFlight\(\)/);
});

test('live feeds use durable display snapshots and still refresh visibly from no-store sources', () => {
  assert.doesNotMatch(statsSource, /unstable_cache|CORE_RESULTS_CACHE_MS|coreResultsCache/);
  assert.doesNotMatch(bettingSource, /unstable_cache|lastSuccessfulFixturesBoard|FIXTURES_RETRY/);
  assert.match(bettingSource, /wtslCore\.fixturesBoard\(\)/);
  assert.match(bettingSource, /fixturesBoardRequest/);
  assert.match(publicFeedsSource, /fetch\('\/api\/live-fixtures', \{ cache: 'no-store'/);
  assert.match(publicFeedsSource, /fetch\(`\/api\/live-results\?\$\{query\}`, \{ cache: 'no-store'/);
  assert.match(publicFeedsSource, /setInterval\(\(\) => void refresh\(\), 30_000\)/);
  assert.match(publicFeedsSource, /setInterval\(\(\) => void refresh\(\), 60_000\)/);
  assert.match(snapshotStoreSource, /ON CONFLICT \(snapshot_key\) DO UPDATE/);
  assert.match(snapshotSyncSource, /isWtslSyncAuthorized/);
  assert.match(snapshotSyncSource, /wtslCore\.results\(366\)/);
  assert.match(snapshotSyncSource, /predictionsLeaderboard\(100\)/);
});

test('public results request a bounded Core window and keep the results timeout', () => {
  assert.match(statsSource, /const PUBLIC_WTSL_RESULTS_WINDOW_DAYS = 30/);
  assert.match(statsSource, /wtslCore\.results\(PUBLIC_WTSL_RESULTS_WINDOW_DAYS\)/);
  assert.match(coreSource, /results: \(days\?: number\)/);
  assert.match(coreSource, /\/api\/core\/results\?days=/);
  assert.match(coreSource, /const routePath = path\.split\('\?', 1\)\[0\]/);
  assert.match(coreSource, /routePath === '\/api\/core\/results'/);
});
