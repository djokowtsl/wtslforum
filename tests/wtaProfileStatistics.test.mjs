import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import test from 'node:test';
import { buildWtaProfileStatLines } from '../lib/wtaProfileStatistics.ts';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const { renderToStaticMarkup } = require('react-dom/server');
const { createElement } = require('react');
const componentSource = await readFile(
  new URL('../components/WtaProfileMatchStatistics.tsx', import.meta.url), 'utf8',
);
const componentModule = new Module(import.meta.url);
componentModule.require = (name) => name === '@/lib/wtaProfileStatistics'
  ? { buildWtaProfileStatLines } : require(name);
componentModule._compile(transformSync(componentSource, {
  filename: 'WtaProfileMatchStatistics.tsx',
  jsc: {
    parser: { syntax: 'typescript', tsx: true },
    transform: { react: { runtime: 'automatic' } },
    target: 'es2022',
  },
  module: { type: 'commonjs' },
}).code, 'WtaProfileMatchStatistics.js');
const WtaProfileMatchStatistics = componentModule.exports.default;

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
  assert.match(html, /title="WTA averages from eligible screenshot matches/);
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

test('the query is tour-and-player scoped, while ATP keeps its existing profile panel', async () => {
  const data = await readFile(new URL('../lib/botRatingLeaderboards.ts', import.meta.url), 'utf8');
  const query = data.slice(data.indexOf('export async function wtaProfileScreenshotStats('), data.indexOf('export type BotRatingStatsRow'));
  assert.match(query, /p\.tour=b\.tour/);
  assert.match(query, /b\.tour='TE4_\(F\)' AND p\.wtsl_player_id=\$\{playerId\}/);
  assert.doesNotMatch(query, /LEADERBOARD_MIN_MATCHES|ensureTable|CREATE|UPDATE|DELETE/);
  assert.match(query, /rows\.length > 1/);
  const page = await readFile(new URL('../app/players/[id]/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /tour === 'TE4_\(F\)'[\s\S]*wtaProfileScreenshotStats\(id\)/);
  assert.match(page, /tour === 'TE4_\(F\)' \? \([\s\S]*WtaProfileMatchStatistics/);
  assert.match(page, /statLines\.map/);
});
