import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const snapshotsSource = await readFile(new URL('../lib/siteSnapshots.ts', import.meta.url), 'utf8');
let rows = new Map();
let fail = false;
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
};
const content = (payload) => {
  const { checkedAt, updatedAt, ...data } = payload;
  return JSON.stringify(canonical(data));
};
// Model the PostgreSQL JSONB contract; also assert that the actual SQL uses
// an atomic comparison, metadata exclusion, and the stale-writer guard.
const sql = async (parts, ...values) => {
  if (fail) throw new Error('database unavailable');
  const query = parts.join('?');
  if (query.includes('CREATE ')) return [];
  if (query.includes('SELECT payload, checked_at')) return rows.has(values[0]) ? [rows.get(values[0])] : [];
  assert.match(query, /IS DISTINCT FROM/);
  assert.match(query, /payload - 'checkedAt' - 'updatedAt'/);
  assert.match(query, /checked_at <= EXCLUDED.checked_at/);
  assert.match(query, /RETURNING payload ->> 'updatedAt'/);
  const [key, isFeed, serialized, timestamp] = values;
  const payload = JSON.parse(serialized);
  const previous = rows.get(key);
  if (previous && previous.checked_at > timestamp) return [];
  if (isFeed) {
    payload.updatedAt = !previous || content(previous.payload) !== content(payload)
      ? timestamp : previous.payload.updatedAt ?? null;
  }
  rows.set(key, { payload, checked_at: timestamp });
  return [{ updated_at: payload.updatedAt ?? null }];
};
const mod = new Module(import.meta.url);
mod.require = (name) => {
  if (name === '@/lib/db') return { sql };
  return require(name);
};
mod._compile(transformSync(snapshotsSource, {
  filename: 'siteSnapshots.ts',
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
  module: { type: 'commonjs' },
}).code, 'siteSnapshots.js');
const { writeSiteSnapshot, readSiteSnapshot, getPublicSiteSnapshot } = mod.exports;
const first = '2026-10-09T12:00:00.000Z';
const later = '2026-10-09T12:05:00.000Z';
test.beforeEach(() => { rows = new Map(); fail = false; });

test('unchanged polling and metadata do not advance the persisted update time', async () => {
  assert.equal(await writeSiteSnapshot('live-results:TE4', { results: [], tournamentNames: {} }, first), first);
  assert.equal(await writeSiteSnapshot('live-results:TE4', { checkedAt: later, updatedAt: later, tournamentNames: {}, results: [] }, later), first);
  const saved = await readSiteSnapshot('live-results:TE4');
  assert.equal(saved.updatedAt, first);
  assert.equal(saved.checkedAt, later);
});
test('new walkover results, corrections, and removals advance update time', async () => {
  const result = { player_one_name: 'Nick1234567', player_two_name: 'Boyzzz', score: 'Walkover' };
  await writeSiteSnapshot('live-results:TE4', { results: [], tournamentNames: {} }, first);
  assert.equal(await writeSiteSnapshot('live-results:TE4', { results: [result], tournamentNames: {} }, later), later);
  assert.equal(await writeSiteSnapshot('live-results:TE4', { results: [{ ...result, winner_id: '1284' }], tournamentNames: {} }, '2026-10-09T12:06:00.000Z'), '2026-10-09T12:06:00.000Z');
  assert.equal(await writeSiteSnapshot('live-results:TE4', { results: [], tournamentNames: {} }, '2026-10-09T12:07:00.000Z'), '2026-10-09T12:07:00.000Z');
});
test('fixtures, live scores, and tours retain independent content-update times', async () => {
  for (const key of ['live-fixtures', 'live-scores', 'live-results:TE4_(F)']) {
    const payload = key === 'live-fixtures' ? { publicOpen: [], bettingBoard: { open: [], recent_settled: [] } } : { matches: [] };
    await writeSiteSnapshot(key, payload, first);
    assert.equal(await writeSiteSnapshot(key, { ...payload, checkedAt: later }, later), first);
    assert.equal(await writeSiteSnapshot(key, { ...payload, newContent: 'changed' }, later), later);
  }
});
test('legacy snapshots do not invent a content-change time from a check', async () => {
  rows.set('live-scores', { payload: { matches: [] }, checked_at: first });
  assert.equal(await writeSiteSnapshot('live-scores', { matches: [] }, later), null);
  assert.equal((await readSiteSnapshot('live-scores')).updatedAt, null);
});
test('older concurrent writes cannot replace newer content or timestamp', async () => {
  await writeSiteSnapshot('live-scores', { matches: [{ score: '6-4' }] }, later);
  assert.equal(await writeSiteSnapshot('live-scores', { matches: [] }, first), null);
  assert.equal((await readSiteSnapshot('live-scores')).updatedAt, later);
});
test('first render propagates persisted update time; failed persistence does not fabricate it', async () => {
  const loaded = await getPublicSiteSnapshot('live-scores', async () => ({ matches: [], checkedAt: first }));
  assert.equal(loaded.updatedAt, first);
  fail = true;
  const warn = console.warn;
  console.warn = () => {};
  try {
    const unavailableTime = await getPublicSiteSnapshot('live-results:TE4', async () => ({ results: [], checkedAt: later }));
    assert.equal(unavailableTime.updatedAt, null);
  } finally { console.warn = warn; }
});
test('unrelated page snapshots keep their payload shape', async () => {
  const payload = [{ name: 'player' }];
  await writeSiteSnapshot('players:TE4', payload, first);
  assert.deepEqual((await readSiteSnapshot('players:TE4')).payload, payload);
});
test('all public feed labels use content-update time, never polling time', async () => {
  for (const file of ['components/LiveMatchPanels.tsx', 'components/LiveScores.tsx']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /FeedUpdatedAt updatedAt=/);
    assert.doesNotMatch(source, /Source checked|Last verified snapshot|Last checked/);
  }
  for (const file of ['app/api/live-results/route.ts', 'app/api/live-fixtures/route.ts', 'app/api/live-scores/route.ts']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /const updatedAt = await writeSiteSnapshot/);
    assert.match(source, /return null/);
  }
});
test('the actual timestamp component renders Updated at or an honest unknown state', async () => {
  const source = await readFile(new URL('../components/FeedUpdatedAt.tsx', import.meta.url), 'utf8');
  const component = new Module(import.meta.url);
  component.require = require;
  component._compile(transformSync(source, {
    filename: 'FeedUpdatedAt.tsx',
    jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  }).code, 'FeedUpdatedAt.js');
  const { createElement } = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const render = (updatedAt) => renderToStaticMarkup(createElement(component.exports.default, { updatedAt }));
  assert.match(render(first), /Updated at/);
  assert.match(render(first), /datetime="2026-10-09T12:00:00.000Z"/i);
  for (const time of [null, undefined, 'invalid']) {
    assert.equal(render(time), '<span>Update time unavailable</span>');
  }
});
