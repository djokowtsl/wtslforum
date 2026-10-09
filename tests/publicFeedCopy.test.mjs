import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const render = (Component, props = {}) => renderToStaticMarkup(createElement(Component, props));
async function compile(file, deps = {}) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  const mod = new Module(import.meta.url);
  mod.require = (name) => name in deps ? deps[name] : require(name);
  mod._compile(transformSync(source, {
    filename: file,
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  }).code, file);
  return mod.exports;
}
const FeedUpdatedAt = (await compile('components/FeedUpdatedAt.tsx')).default;
const fixture = { key: 'fixture', first_name: 'Alice', second_name: 'Bob', tour: 'TE4', status: 'open', odds_one: 2, odds_two: 2 };
let fixtures;
let results;
const shared = {
  'next/link': { __esModule: true, default: ({ children, href }) => createElement('a', { href }, children) },
  '@/components/FeedUpdatedAt': { __esModule: true, default: FeedUpdatedAt },
  '@/components/PublicLiveData': {
    usePublicFixtures: () => fixtures,
    usePublicResults: () => results,
  },
  '@/lib/format': { fmtDateTime: () => 'date', timeAgo: () => 'date', matchDateLabel: () => 'date' },
};
const panels = await compile('components/LiveMatchPanels.tsx', {
  ...shared,
  '@/components/MatchCards': {
    FixtureCard: () => createElement('div', null, 'Fixture card'),
    ResultCard: () => createElement('div', null, 'Result card'),
  },
});
const betting = await compile('components/BettingPanels.tsx', {
  ...shared,
  '@/lib/betting-ledger': { fetchBetLedger: () => { throw new Error('Public panels must not read private ledgers'); } },
});
function initialize(updatedAt = null) {
  fixtures = { status: 'ready', source: 'snapshot', checkedAt: '2026-10-09T12:30:00Z',
    updatedAt, publicOpen: [fixture], bettingBoard: { open: [fixture], recent_settled: [] } };
  results = { status: 'ready', source: 'snapshot', checkedAt: fixtures.checkedAt,
    updatedAt, results: [{ id: 'result' }], tournamentNames: {} };
}
const views = [
  [panels.HomeOpenFixtures, {}],
  [panels.MatchesOpenFixtures, { tour: 'TE4' }],
  [panels.HomeRecentResults, {}],
  [panels.MatchesRecentResults, {}],
  [betting.BettingBoardPanels, {}],
];
test('saved public feeds hide unknown timestamps and routine diagnostics, including empty timestamp wrappers', () => {
  initialize();
  for (const [Component, props] of views) {
    const html = render(Component, props);
    assert.doesNotMatch(html, /Update time unavailable|Last Updated|feed-freshness/);
    assert.doesNotMatch(html, /snapshot|background|LAST VERIFIED|eligibility.*check/i);
  }
});
test('all result, fixture and betting views show known content-update time instead of the newer check time', () => {
  initialize('2026-10-09T12:00:00Z');
  for (const [Component, props] of views) {
    const html = render(Component, props);
    assert.match(html, /Last Updated/);
    assert.match(html, /dateTime="2026-10-09T12:00:00.000Z"/i);
    assert.doesNotMatch(html, /12:30|snapshot|background/i);
  }
});
test('real loading failures remain explicit in plain public language', () => {
  initialize();
  fixtures.status = 'unavailable';
  results.status = 'unavailable';
  for (const [Component, props] of views) {
    const html = render(Component, props);
    assert.match(html, /unavailable/i);
    assert.doesNotMatch(html, /snapshot|background|official-draw|eligibility/i);
  }
  initialize();
  fixtures.refreshError = true;
  results.refreshError = true;
  for (const [Component, props] of views) {
    const html = render(Component, props);
    assert.match(html, /Unable to refresh/);
    assert.doesNotMatch(html, /snapshot|background/i);
  }
});
test('public footer and predictions do not expose poll times or operational sync notices', async () => {
  const footer = await readFile(new URL('../components/ForumFooter.tsx', import.meta.url), 'utf8');
  const predictions = await readFile(new URL('../app/predictions/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(footer, /PublicSnapshotFreshness/);
  assert.doesNotMatch(predictions, /Standings checked|predictions snapshot|background sync/);
});
