import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import test from 'node:test';
import { buildProfileStatLines as buildWtaProfileStatLines } from '../lib/profileStatistics.ts';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const { renderToStaticMarkup } = require('react-dom/server');
const { createElement } = require('react');
const componentSource = await readFile(
  new URL('../components/ProfileMatchStatistics.tsx', import.meta.url), 'utf8',
);
const componentModule = new Module(import.meta.url);
componentModule.require = (name) => name === '@/lib/profileStatistics'
  ? { buildProfileStatLines: buildWtaProfileStatLines } : require(name);
componentModule._compile(transformSync(componentSource, {
  filename: 'WtaProfileMatchStatistics.tsx',
  jsc: {
    parser: { syntax: 'typescript', tsx: true },
    transform: { react: { runtime: 'automatic' } },
    target: 'es2022',
  },
  module: { type: 'commonjs' },
}).code, 'WtaProfileMatchStatistics.js');
const WtaProfileMatchStatistics = (props) => createElement(componentModule.exports.default, { tour: 'TE4_(F)', ...props });

const snapshot = {
  screenshots: 38,
  metrics: { '1st Serve %': 0.711, Aces: 0, 'Avg 1st Serve Speed': 174.256 },
  metricSampleCounts: { '1st Serve %': 38, Aces: 27, 'Avg 1st Serve Speed': 12 },
};

test('WTA screenshot statistics use metric-specific samples and km/h', () => {
  const lines = buildWtaProfileStatLines(snapshot);
  assert.equal(lines.length, 17);
  assert.deepEqual(lines.find(row => row.label === 'First serve %'),
    { label: 'First serve %', value: '71.1%', sampleCount: 38 });
  assert.deepEqual(lines.find(row => row.label === 'Avg 1st serve speed'),
    { label: 'Avg 1st serve speed', value: '174.26 km/h', sampleCount: 12 });
  assert.deepEqual(lines.find(row => row.label === 'Avg aces'),
    { label: 'Avg aces', value: '0', sampleCount: 27 });
});

test('missing values never become fabricated zeroes', () => {
  assert.ok(buildWtaProfileStatLines(null).every(row => row.value === 'Unavailable'));
  for (const value of [null, undefined, '', ' ', NaN, Infinity, -1, {}]) {
    const lines = buildWtaProfileStatLines({
      screenshots: 3, metrics: { Aces: value }, metricSampleCounts: { Aces: 3 },
    });
    assert.equal(lines.find(row => row.label === 'Avg aces').value, 'Unavailable');
  }
});

test('metrics without supported sample counts are unavailable even if stored as zero', () => {
  for (const count of [null, undefined, 0, -1, 0.5, 4, '', 'not-a-count']) {
    const lines = buildWtaProfileStatLines({
      screenshots: 3, metrics: { Aces: 0 }, metricSampleCounts: { Aces: count },
    });
    assert.equal(lines.find(row => row.label === 'Avg aces').value, 'Unavailable');
  }
});

test('a profile may show one measured match without meeting leaderboard eligibility', () => {
  const row = buildWtaProfileStatLines({
    screenshots: 1, metrics: { Aces: '2' }, metricSampleCounts: { Aces: '1' },
  }).find(row => row.label === 'Avg aces');
  assert.equal(row.value, '2');
  assert.equal(row.sampleCount, 1);
});

test('percentage fractions and percentage points format consistently', () => {
  for (const [input, expected] of [[0, '0%'], [1, '100%'], [0.65, '65%'], [65, '65%'], [100, '100%'], [101, 'Unavailable']]) {
    const row = buildWtaProfileStatLines({
      screenshots: 2,
      metrics: { '1st Serve %': input },
      metricSampleCounts: { '1st Serve %': 2 },
    }).find(row => row.label === 'First serve %');
    assert.equal(row.value, expected);
  }
});

test('the rendered profile labels source, sample coverage, values and missing metrics', () => {
  const html = renderToStaticMarkup(createElement(WtaProfileMatchStatistics, { snapshot }));
  assert.match(html, /Screenshot-derived/);
  assert.match(html, /not official WTSL profile averages/);
  assert.match(html, /not a complete career record/);
  assert.match(html, /title="Averages from eligible screenshot matches/);
  assert.doesNotMatch(html, /<p\b/);
  assert.match(html, /71\.1%/);
  assert.match(html, /38 matches/);
  assert.match(html, /27 matches/);
  assert.match(html, /174\.26 km\/h/);
  assert.match(html, /Unavailable/);
  assert.match(html, /<strong>0<\/strong>/);
});

test('ATP and populated WTA match-statistics sections have no description paragraphs', async () => {
  const page = await readFile(new URL('../app/players/[id]/page.tsx', import.meta.url), 'utf8');
  const atpSection = page.slice(page.indexOf(') : <section className="panel">'), page.indexOf('</section>}'));
  assert.match(atpSection, /Match Statistics/);
  assert.doesNotMatch(atpSection, /<p\b/);
  const wtaHtml = renderToStaticMarkup(createElement(WtaProfileMatchStatistics, { snapshot }));
  assert.doesNotMatch(wtaHtml, /<p\b/);
});

test('no-data and query-failure profiles explain why the statistics are unavailable', () => {
  const empty = renderToStaticMarkup(createElement(WtaProfileMatchStatistics, { snapshot: null }));
  assert.match(empty, /No eligible WTA screenshot statistics/);
  assert.doesNotMatch(empty, /<strong>0/);
  const failed = renderToStaticMarkup(createElement(WtaProfileMatchStatistics, { snapshot: null, unavailable: true }));
  assert.match(failed, /temporarily unavailable/);
  assert.match(failed, /role="status"/);
});

test('the shared query is tour-and-player scoped and both singles tours use it', async () => {
  const data = await readFile(new URL('../lib/botRatingLeaderboards.ts', import.meta.url), 'utf8');
  const query = data.slice(data.indexOf('export async function profileScreenshotStats('), data.indexOf('export type BotRatingStatsRow'));
  assert.match(query, /p\.tour=b\.tour/);
  assert.match(query, /b\.tour=\$\{tour\} AND p\.wtsl_player_id=\$\{playerId\}/);
  assert.doesNotMatch(query, /LEADERBOARD_MIN_MATCHES|ensureTable|CREATE|UPDATE|DELETE/);
  assert.match(query, /rows\.length > 1/);
  const page = await readFile(new URL('../app/players/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /tour === 'TE4' \|\| tour === 'TE4_\(F\)'[\s\S]*profileScreenshotStats\(id, tour\)/);
  assert.match(page, /<ProfileMatchStatistics \{\.\.\.screenshotStats\} tour=\{tour\}/);
  assert.match(page, /statLines\.map/);
});

test('ATP and WTA use identical badges, metric-specific counts, and no introductory descriptions', () => {
  const render = (tour) => renderToStaticMarkup(createElement(WtaProfileMatchStatistics, { snapshot, tour }));
  const atp = render('TE4');
  const wta = render('TE4_(F)');
  assert.equal(atp.replace('ATP screenshot-derived', 'WTA screenshot-derived'), wta);
  for (const html of [atp, wta]) {
    assert.match(html, /Screenshot-derived/);
    assert.match(html, /38 matches/);
    assert.match(html, /27 matches/);
    assert.match(html, /12 matches/);
    assert.doesNotMatch(html, /<p\b/);
  }
});

test('ATP no-data and failures are honest, not fallback WTSL averages or manufactured zeros', () => {
  const render = (props) => renderToStaticMarkup(createElement(WtaProfileMatchStatistics, { tour: 'TE4', ...props }));
  assert.match(render({ snapshot: null }), /No eligible ATP screenshot statistics/);
  assert.doesNotMatch(render({ snapshot: null }), /<strong>0/);
  assert.match(render({ snapshot: null, unavailable: true }), /temporarily unavailable/);
});

const leaderboardSource = await readFile(new URL('../lib/botRatingLeaderboards.ts', import.meta.url), 'utf8');
const querySource = leaderboardSource.slice(
  leaderboardSource.indexOf('export async function profileScreenshotStats('),
  leaderboardSource.indexOf('export type BotRatingStatsRow'),
);
const queryModule = new Module(import.meta.url);
let queryRows = [];
let queryCalls = [];
queryModule.require = (name) => {
  if (name !== '@/lib/db') throw new Error(`Unexpected dependency: ${name}`);
  return { sql: async (parts, ...values) => {
    const sql = parts.join('?');
    assert.match(sql, /p\.tour=b\.tour/);
    assert.match(sql, /lower\(p\.name\)=lower\(b\.player_name\)/);
    assert.match(sql, /b\.tour=\? AND p\.wtsl_player_id=\?/);
    queryCalls.push(values);
    return queryRows;
  } };
};
queryModule._compile(transformSync(`import { sql } from '@/lib/db';\n${querySource}`, {
  filename: 'profileQuery.ts',
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
  module: { type: 'commonjs' },
}).code, 'profileQuery.js');
const { profileScreenshotStats } = queryModule.exports;

test('the reader binds each requested tour and player ID, including same-ID cross-tour players', async () => {
  queryCalls = [];
  queryRows = [{ screenshots: 7, metrics: { Aces: 2 }, metric_sample_counts: { Aces: 5 } }];
  const atp = await profileScreenshotStats('123', 'TE4');
  queryRows = [{ screenshots: 38, metrics: { Aces: 4 }, metric_sample_counts: { Aces: 27 } }];
  const wta = await profileScreenshotStats('123', 'TE4_(F)');
  assert.deepEqual(queryCalls, [['TE4', '123'], ['TE4_(F)', '123']]);
  assert.equal(atp.metricSampleCounts.Aces, 5);
  assert.equal(wta.metricSampleCounts.Aces, 27);
  assert.equal(atp.metrics.Aces, 2);
});

test('the reader fails closed on ambiguous identity and rejects unsupported tours', async () => {
  queryRows = [{ screenshots: 1 }, { screenshots: 1 }];
  for (const tour of ['TE4', 'TE4_(F)']) {
    await assert.rejects(profileScreenshotStats('123', tour), /Ambiguous/);
  }
  queryCalls = [];
  await assert.rejects(profileScreenshotStats('123', 'TE4_DB'), /singles tour/);
  assert.equal(queryCalls.length, 0);
});

test('a missing screenshot row stays null; a one-match sample is still available', async () => {
  queryRows = [];
  assert.equal(await profileScreenshotStats('123', 'TE4'), null);
  queryRows = [{ screenshots: 1, metrics: { Aces: 0 }, metric_sample_counts: { Aces: 1 } }];
  const measured = await profileScreenshotStats('123', 'TE4');
  const aces = buildWtaProfileStatLines(measured).find(row => row.label === 'Avg aces');
  assert.deepEqual(aces, { label: 'Avg aces', value: '0', sampleCount: 1 });
});
