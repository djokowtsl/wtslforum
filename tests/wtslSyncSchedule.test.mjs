import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const config = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
);
const githubWorkflow = readFileSync(
  new URL('../.github/workflows/wtsl-public-sync.yml', import.meta.url),
  'utf8',
);
const snapshotSyncRoute = readFileSync(
  new URL('../app/api/sync/public-page-snapshots/route.ts', import.meta.url),
  'utf8',
);
const freshnessRoute = readFileSync(
  new URL('../app/api/public-page-snapshot-status/route.ts', import.meta.url),
  'utf8',
);
const footer = readFileSync(
  new URL('../components/ForumFooter.tsx', import.meta.url),
  'utf8',
);
const freshnessComponent = readFileSync(
  new URL('../components/PublicSnapshotFreshness.tsx', import.meta.url),
  'utf8',
);
const pageRefresh = readFileSync(
  new URL('../components/SnapshotAutoRefresh.tsx', import.meta.url),
  'utf8',
);

test('Vercel Hobby keeps only the daily stats sync', () => {
  const schedules = new Map(config.crons.map(({ path, schedule }) => [path, schedule]));

  assert.deepEqual([...schedules], [['/api/sync/wtsl-stats', '0 3 * * *']]);
});

test('GitHub Actions runs fast syncs and uses the protected secret without exposing it', () => {
  assert.match(githubWorkflow, /cron: '3-58\/5 \* \* \* \*'/);
  assert.match(githubWorkflow, /cron: '17 \* \* \* \*'/);
  assert.match(githubWorkflow, /cron: '10,40 \* \* \* \*'/);
  assert.match(githubWorkflow, /secrets\.WTSL_SYNC_SECRET/);
  assert.match(githubWorkflow, /x-wtsl-sync-secret/);
  assert.match(githubWorkflow, /api\/sync\/\$\{SYNC_ROUTE\}/);
  assert.match(pageRefresh, /SNAPSHOT_REFRESH_INTERVAL_MS = 300_000/);
});

test('full-sync diagnostics are retained without a public footer notice', () => {
  assert.match(snapshotSyncRoute, /failed\.length === 0[\s\S]*public-page-snapshot-sync-status/);
  assert.match(freshnessRoute, /public-page-snapshot-sync-status/);
  assert.match(freshnessRoute, /lastRefreshedAt/);
  assert.doesNotMatch(footer, /PublicSnapshotFreshness/);
  assert.match(freshnessComponent, /Last full public-data snapshot refresh:/);
  assert.match(freshnessComponent, /Live panels may update sooner while you browse/);
});
