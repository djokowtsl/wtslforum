import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const statsSource = await readFile(new URL('../lib/stats.ts', import.meta.url), 'utf8');
const bettingSource = await readFile(new URL('../lib/betting.ts', import.meta.url), 'utf8');
const autoRefreshSource = await readFile(
  new URL('../components/WtslDataAutoRefresh.tsx', import.meta.url),
  'utf8',
);
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
  assert.match(
    statsSource,
    /Promise\.all\(\[\s*profileRowsPromise,\s*coreRowsPromise/,
  );
  assert.match(statsSource, /wtslCoreResultsInFlight\(\)/);
});

test('public match boards avoid retained result caches and refresh visible pages frequently', () => {
  assert.doesNotMatch(statsSource, /unstable_cache|CORE_RESULTS_CACHE_MS|coreResultsCache/);
  assert.doesNotMatch(bettingSource, /unstable_cache|lastSuccessfulFixturesBoard|FIXTURES_RETRY/);
  assert.match(bettingSource, /wtslCore\.fixturesBoard\(\)/);
  assert.match(bettingSource, /fixturesBoardRequest/);
  assert.match(autoRefreshSource, /LIVE_DATA_REFRESH_INTERVAL_MS = 15_000/);
});
