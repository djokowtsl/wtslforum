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
