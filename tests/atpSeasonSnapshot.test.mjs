import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildPlayerSeasonHighlights } from '../lib/playerSeasonHighlights.ts';

process.env.WTSL_CORE_API_URL = 'https://core.example.test';
process.env.WTSL_CORE_API_KEY = 'test-only-key';
const { wtslCore } = await import('../lib/wtsl-core.ts');

test('season snapshot and dashboard both request full history, not a rolling days window', async () => {
  for (const path of [
    '../app/api/sync/public-page-snapshots/route.ts',
    '../app/dashboard/page.tsx',
  ]) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /wtslCore\.results\(\)/);
    assert.doesNotMatch(source, /wtslCore\.results\(\s*\d+\s*\)/);
  }
});

test('the supported full-history request preserves both ends of a leap-year season', async (t) => {
  const rows = ['31.12.2023', '01.01.2024', '29.02.2024', '31.12.2024', '01.01.2025']
    .map((date, index) => ({
      date,
      tour: 'TE4',
      p1: 'Aster',
      p2: 'Birch',
      result: '6-0 6-0',
      tournament: `Official Event ${index}`,
      round: 'First Round',
    }));
  const originalFetch = globalThis.fetch;
  let requestedUrl;
  globalThis.fetch = async (url) => {
    requestedUrl = new URL(url);
    const days = requestedUrl.searchParams.get('days');
    if (days !== null && Number(days) > 365) {
      return Response.json({ error: 'invalid_days' }, { status: 400 });
    }
    return Response.json(rows);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const history = await wtslCore.results();
  assert.equal(requestedUrl.pathname, '/api/core/results');
  assert.equal(requestedUrl.search, '');
  assert.deepEqual(history, rows);
  const highlights = buildPlayerSeasonHighlights(history, 'Aster', 'TE4', 2024);
  assert.equal(highlights.matches, 3);
  assert.equal(highlights.wins, 3);
  assert.equal(highlights.losses, 0);
});
