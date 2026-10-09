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
  const [panels, dashboard, season] = await Promise.all([
    'components/LiveMatchPanels.tsx', 'app/dashboard/page.tsx',
    'components/PlayerSeasonHighlights.tsx',
  ].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));
  assert.match(panels, /feed\.status === 'unavailable'/);
  assert.match(panels, /this does not mean the tour has no matches/);
  assert.match(dashboard, /: coreSeasonResults\.unavailable/);
  assert.match(season, /Official season match results are unavailable/);
});

test('live-data sections are fetched after page rendering instead of holding route responses open', async () => {
  const [home, matches, betting] = await Promise.all([
    'app/page.tsx',
    'app/matches/page.tsx',
    'app/betting/page.tsx',
  ].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));

  assert.match(home, /<PublicResultsProvider limit=\{3\} tour="TE4">/);
  assert.match(home, /<PublicFixturesProvider>/);
  assert.match(matches, /<PublicResultsProvider limit=\{30\} tour=\{tour\}>/);
  assert.match(matches, /<PublicFixturesProvider enabled=\{supportsBetting\}>/);
  assert.match(betting, /<PublicFixturesProvider>/);

  for (const page of [home, matches, betting]) {
    assert.doesNotMatch(page, /await (?:recentWtslSiteMatches|fixturesBoard|openFixtures)\(/);
    assert.doesNotMatch(page, /<Suspense/);
  }
});

test('fixture and results endpoints are live no-store reads with explicit unavailable responses', async () => {
  const [fixtures, results, client] = await Promise.all([
    readFile(new URL('../app/api/live-fixtures/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/live-results/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../components/LiveMatchPanels.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(fixtures, /fixturesBoard\(\)/);
  assert.match(fixtures, /cache-control.*no-store/);
  assert.match(fixtures, /status: 503/);
  assert.match(results, /recentWtslSiteMatches/);
  assert.match(results, /cache-control.*no-store/);
  assert.match(client, /official-draw check could not be completed/i);
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

test('page data sections stay quiet instead of showing loading placeholders', async () => {
  const [livePanels, bettingPanels, screenshotRecords] = await Promise.all([
    'components/LiveMatchPanels.tsx',
    'components/BettingPanels.tsx',
    'components/ScreenshotRecordsViewer.tsx',
  ].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));

  assert.doesNotMatch(livePanels, /Updating from the WTSL|Confirming upcoming pairings|Results update independently/);
  assert.doesNotMatch(bettingPanels, /Checking official draws|Loading the betting ledger|Your ledger is loading/);
  assert.doesNotMatch(screenshotRecords, /Loading (?:players|opponents|tournaments|years|screenshot rows)/);
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
  const unavailableBranch = client.indexOf("ledgerStatus === 'unavailable' ?");
  const emptyLedgerBranch = client.indexOf("bets.length === 0 ?");
  assert(unavailableBranch >= 0 && emptyLedgerBranch > unavailableBranch,
    'the explicit API error state must be rendered before the successful empty-ledger state');
});
