import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readLiveData } from '../lib/liveData.ts';

test('successful empty feed is distinct from a failed feed', async () => {
  assert.deepEqual(await readLiveData(async () => [], []), { data: [], unavailable: false });
  assert.deepEqual(await readLiveData(async () => { throw new Error('timeout'); }, []),
    { data: [], unavailable: true });
});

test('valid nonempty data is preserved', async () => {
  const rows = [{ key: 'live' }];
  assert.deepEqual(await readLiveData(async () => rows, []), { data: rows, unavailable: false });
});

test('board and season views propagate availability rather than manufacturing empty histories', async () => {
  const [matches, betting, dashboard, season] = await Promise.all([
    'app/matches/page.tsx', 'app/betting/page.tsx', 'app/dashboard/page.tsx',
    'components/PlayerSeasonHighlights.tsx',
  ].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));
  assert.match(matches, /supportsBetting && fixturesState\.unavailable/);
  assert.match(betting, /boardState\.unavailable \? null : fixtures\.length/);
  assert.match(betting, /boardState\.unavailable \? null : settled\.length/);
  assert.match(dashboard, /: coreSeasonResults\.unavailable/);
  assert.match(season, /Official season match results are unavailable/);
});

test('Matches streams fixture verification and recent results independently', async () => {
  const matches = await readFile(new URL('../app/matches/page.tsx', import.meta.url), 'utf8');
  assert.match(matches, /<Suspense fallback={<MatchesDataLoading label="Checking live fixtures"/);
  assert.match(matches, /<OpenFixturesSection tour={tour} \/>/);
  assert.match(matches, /<Suspense fallback={<MatchesDataLoading label="Loading recent results"/);
  assert.match(matches, /<RecentResultsSection tour={tour} \/>/);
  assert.doesNotMatch(matches, /const \[results, fixturesState, tournaments\] = await Promise\.all/);
});

test('homepage and Virtual Betting stream live feeds outside their page-level render', async () => {
  const [home, betting] = await Promise.all([
    readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/betting/page.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(home, /<Suspense fallback={<LiveSectionLoading label="Loading recent results\."/);
  assert.match(home, /<HomeRecentResults tournaments=\{tournaments\} \/>/);
  assert.match(home, /<Suspense fallback={<LiveSectionLoading label="Verifying open fixtures\."/);
  assert.match(home, /<HomeOpenFixtures tournaments=\{tournaments\} \/>/);
  assert.match(betting, /<Suspense fallback={<BettingDataLoading title="Verifying open fixtures\."/);
  assert.match(betting, /<BettingBoardSections \/>/);
  assert.match(betting, /<BettingAccountSummary discordId=\{user\.discordId\} \/>/);
  assert.match(betting, /<BettingLedger discordId=\{user\.discordId\} \/>/);
});
