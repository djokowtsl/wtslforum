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

test('board and season views preserve explicit unavailable states for missing snapshots', async () => {
  const [panels, dashboard, season] = await Promise.all([
    'components/LiveMatchPanels.tsx', 'app/dashboard/page.tsx',
    'components/PlayerSeasonHighlights.tsx',
  ].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));
  assert.match(panels, /feed\.status === 'unavailable'/);
  assert.match(panels, /Open fixtures unavailable/);
  assert.match(dashboard, /getPublicSiteSnapshot/);
  assert.match(dashboard, /seasonUnavailable:/);
  assert.match(season, /Official season match results are unavailable/);
});

test('public live sections render saved snapshots before no-store background refreshes', async () => {
  const [home, matches, betting, publicData, snapshotReader] = await Promise.all([
    'app/page.tsx',
    'app/matches/page.tsx',
    'app/betting/page.tsx',
    'lib/publicPageData.ts',
    'components/PublicLiveData.tsx',
  ].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));

  assert.match(home, /initialPublicResults\(3, 'TE4'\)/);
  assert.match(home, /<PublicResultsProvider limit=\{3\} tour="TE4" initialFeed=\{initialResults\}>/);
  assert.match(home, /<PublicFixturesProvider initialFeed=\{initialFixtures\}>/);
  assert.match(matches, /initialPublicResults\(30, tour\)/);
  assert.match(matches, /<PublicResultsProvider limit=\{30\} tour=\{tour\} initialFeed=\{initialResults\}>/);
  assert.match(matches, /<PublicFixturesProvider enabled=\{supportsBetting\} initialFeed=\{initialFixtures\}>/);
  assert.match(betting, /<PublicFixturesProvider initialFeed=\{initialFixtures\}>/);
  assert.match(publicData, /getPublicSiteSnapshot/);
  assert.match(publicData, /source: 'snapshot'/);
  assert.match(snapshotReader, /setInterval\(\(\) => void refresh\(\), 30_000\)/);
  assert.match(snapshotReader, /setInterval\(\(\) => void refresh\(\), 60_000\)/);

  for (const page of [home, matches, betting]) {
    assert.doesNotMatch(page, /await (?:recentWtslSiteMatches|fixturesBoard|openFixtures)\(/);
  }
});

test('live endpoints remain no-store, refresh the persisted display snapshots, and fail explicitly', async () => {
  const [fixtures, results, sources, client] = await Promise.all([
    readFile(new URL('../app/api/live-fixtures/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/live-results/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/publicFeeds.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/LiveMatchPanels.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(fixtures, /loadPublicFixtures\(\)/);
  assert.match(fixtures, /writeSiteSnapshot\('live-fixtures'/);
  assert.match(fixtures, /cache-control.*no-store/);
  assert.match(fixtures, /status: 503/);
  assert.match(results, /loadPublicResults\(/);
  assert.match(results, /writeSiteSnapshot\(`live-results:\$\{tour\}`/);
  assert.match(sources, /fixturesBoard\(\)/);
  assert.match(sources, /recentWtslSiteMatches\(limit, tour\)/);
  assert.match(results, /cache-control.*no-store/);
  assert.match(client, /Open fixtures unavailable/);
  assert.match(client, /Please try again later/);
  assert.match(client, /Recent results unavailable/);
});

test('homepage latest-result placeholder offers Matches instead of exposing an implementation detail', async () => {
  const matches = await readFile(new URL('../components/LiveMatchPanels.tsx', import.meta.url), 'utf8');
  const latestResultPanel = matches.split('export function HomeLatestResultSpot()')[1]
    .split('export function HomeRecentResults()')[0];
  assert.match(latestResultPanel, /View match results/);
  assert.doesNotMatch(latestResultPanel, /Recent scores load separately/);
});

test('all routes have no visible full-page loading fallbacks and the app chrome streams immediately', async () => {
  const layout = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /<Suspense fallback=\{null\}>\{children\}<\/Suspense>/);
  for (const path of [
    'app/loading.tsx',
    'app/matches/loading.tsx',
    'app/betting/loading.tsx',
    'app/predictions/loading.tsx',
    'components/LiveDataLoading.tsx',
  ]) {
    await assert.rejects(
      readFile(new URL('../' + path, import.meta.url), 'utf8'),
      (error) => error.code === 'ENOENT',
      `${path} should not render a loading placeholder`,
    );
  }
  const predictions = await readFile(new URL('../app/predictions/page.tsx', import.meta.url), 'utf8');
  assert.match(predictions, /export default function Predictions\(\)/);
  assert.match(predictions, /<Suspense fallback=\{null\}>/);
  assert.match(predictions, /<PredictionsLeaderboard \/>/);
});

test('client sections accept server-rendered first-view data and keep explicit fallback states', async () => {
  const [livePanels, bettingPanels, screenshotRecords, screenshotPage] = await Promise.all([
    'components/LiveMatchPanels.tsx',
    'components/BettingPanels.tsx',
    'components/ScreenshotRecordsViewer.tsx',
    'app/screenshot-stats/page.tsx',
  ].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));

  assert.match(livePanels, /feed\.status === 'loading'/);
  assert.match(bettingPanels, /initialAccount/);
  assert.match(screenshotPage, /initialResult=\{initialRecords\.status === 'fulfilled' \? initialRecords\.value : undefined\}/);
  assert.match(screenshotRecords, /initialFilterOptions/);
  assert.match(screenshotRecords, /initialLoadError/);
  assert.match(screenshotRecords, /placeholder="Search player names"/);
});

test('a failed private betting API read is never presented as an empty ledger', async () => {
  const [balanceRoute, ledgerRoute, client] = await Promise.all([
    readFile(new URL('../app/api/betting/account/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/betting/ledger/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/BettingPanels.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(balanceRoute, /getSession\(\)/);
  assert.match(balanceRoute, /wtslCore\.balance/);
  assert.match(balanceRoute, /status: 503/);
  assert.match(ledgerRoute, /getSession\(\)/);
  assert.match(ledgerRoute, /wtslCore\.bets/);
  assert.match(ledgerRoute, /status: 503/);
  assert.match(client, /Your betting data is unavailable/);
  const bettingPage = await readFile(new URL('../app/betting/page.tsx', import.meta.url), 'utf8');
  assert.match(bettingPage, /wtslCore\.balance\(user\.discordId\)/);
  assert.match(bettingPage, /wtslCore\.bets\(user\.discordId\)/);
  assert.match(bettingPage, /initialAccount=\{account\}/);
  const unavailableBranch = client.indexOf("ledgerStatus === 'unavailable' ?");
  const emptyLedgerBranch = client.indexOf("bets.length === 0 ?");
  assert(unavailableBranch >= 0 && emptyLedgerBranch > unavailableBranch,
    'the explicit API error state must be rendered before the successful empty-ledger state');
});
