import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

function loadModule(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const normalizePlayerName = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');
const dashboardSource = readFileSync(
  new URL('../app/dashboard/page.tsx', import.meta.url),
  'utf8',
);

const { findVerifiedUpcomingFixture, buildDashboardMatchKeys, formatMatchKeyMetric } = loadModule(
  'lib/dashboardMatchKeys.ts',
  { './queries': { normalizePlayerName } },
);

test('upcoming match lookup requires the approved player ID and matching tour', () => {
  const fixtures = [
    {
      key: 'atp-1', tour: 'TE4', first_id: '17', first_name: 'Alpha',
      second_id: '28', second_name: 'Beta', scheduled_at: '2026-11-02T10:00:00Z',
      status: 'open',
    },
    {
      key: 'wta-1', tour: 'TE4_(F)', first_id: '17', first_name: 'Other Alpha',
      second_id: '30', second_name: 'Gamma', scheduled_at: '2026-11-02T10:00:00Z',
      status: 'open',
    },
  ];
  const atpClaim = { wtsl_player_id: '17', player_name: 'Alpha', tour: 'TE4' };

  assert.equal(findVerifiedUpcomingFixture(fixtures, atpClaim)?.key, 'atp-1');
  assert.equal(findVerifiedUpcomingFixture(fixtures, {
    ...atpClaim,
    wtsl_player_id: '999',
  }), null);
  assert.equal(findVerifiedUpcomingFixture(fixtures, {
    ...atpClaim,
    tour: 'TE4_(F)',
  })?.key, 'wta-1');
});

test('multiple upcoming fixtures select the earliest only when all are dated', () => {
  const fixtures = [
    {
      key: 'later', tour: 'TE4', first_id: '17', first_name: 'Alpha',
      second_id: '28', second_name: 'Beta', scheduled_at: '2026-11-03T10:00:00Z',
      status: 'open',
    },
    {
      key: 'earlier', tour: 'TE4', first_id: '29', first_name: 'Gamma',
      second_id: '17', second_name: 'Alpha', scheduled_at: '2026-11-02T10:00:00Z',
      status: 'open',
    },
  ];
  const claim = { wtsl_player_id: '17', player_name: 'Alpha', tour: 'TE4' };

  assert.equal(findVerifiedUpcomingFixture(fixtures, claim)?.key, 'earlier');
  assert.equal(findVerifiedUpcomingFixture([
    fixtures[0],
    { ...fixtures[1], scheduled_at: null },
  ], claim), null);
});

test('match keys use only the verified player and listed opponent MatchLog rows', () => {
  const fixture = {
    key: 'atp-1', tour: 'TE4', first_id: '17', first_name: 'Álpha Ace',
    second_id: '28', second_name: 'Beta Baseline', status: 'open',
    tournament: 'WTSL Open', scheduled_at: '2026-11-02T10:00:00Z',
  };
  const rows = [
    {
      player: 'Alpha Ace', tour: 'atp', source: 'matchlog', matches: 25,
      metrics: { '1st Serve Won %': 0.72, Aces: 6, 'Unforced Errors': 12 },
      ratings: { Serve: 180, Return: 120 },
    },
    {
      player: 'Beta Baseline', tour: 'atp', source: 'matchlog', matches: 22,
      metrics: { '1st Serve Won %': 0.58, Aces: 3, 'Unforced Errors': 15 },
      ratings: {},
    },
    {
      player: 'Álpha Ace', tour: 'atp', source: 'screenshots', matches: 100,
      metrics: { Aces: 99 },
      ratings: {},
    },
  ];
  const data = buildDashboardMatchKeys(fixture, '17', rows);

  assert.equal(data.playerName, 'Álpha Ace');
  assert.equal(data.opponentName, 'Beta Baseline');
  assert.equal(data.playerMatches, 25);
  assert.equal(data.opponentMatches, 22);
  assert.equal(data.noPlayerStats, false);
  assert.ok(data.keys.some((key) => key.metric === 'Aces' && key.playerHasEdge));
  assert.ok(data.keys.some((key) => key.metric === 'Unforced Errors' && key.playerHasEdge));
  assert.equal(formatMatchKeyMetric('1st Serve Won %', 0.72), '72.0%');
  assert.equal(formatMatchKeyMetric('Aces', 6), '6');
});

test('missing player MatchLog rows return no personal keys', () => {
  const fixture = {
    key: 'atp-1', tour: 'TE4', first_id: '17', first_name: 'Alpha',
    second_id: '28', second_name: 'Beta', status: 'open',
  };
  const data = buildDashboardMatchKeys(fixture, '17', []);
  assert.equal(data.noPlayerStats, true);
  assert.deepEqual(data.keys, []);
});

test('dashboard match keys are loaded only after sign-in and from approved claims', () => {
  assert.ok(dashboardSource.indexOf('if (!viewer)') < dashboardSource.indexOf('wtslCore.matchlogLeaderboard'));
  assert.ok(dashboardSource.includes("claims.filter((c: any) => c.status === 'approved')"));
  assert.ok(dashboardSource.includes('findVerifiedUpcomingFixture(fixturesBoard.open, claim)'));
  assert.ok(dashboardSource.includes('<DashboardMatchKeys'));
});
