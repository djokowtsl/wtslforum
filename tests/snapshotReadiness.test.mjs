import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { formatSnapshotRefreshTime } from '../lib/snapshotFreshness.ts';

test('the footer refresh timestamp formats without incompatible Intl options', () => {
  const formatted = formatSnapshotRefreshTime('2026-10-09T11:00:00.000Z');
  assert.match(formatted, /2026/);
  assert.match(formatted, /Oct/);
});

test('profile-feed errors reach allSettled instead of becoming successful empty results', async () => {
  const source = await readFile(new URL('../lib/stats.ts', import.meta.url), 'utf8');
  const profileRequest = source.slice(
    source.indexOf('const profileRowsPromise ='),
    source.indexOf('const [profileResult, coreResult]'),
  );
  assert.doesNotMatch(profileRequest, /\.catch\s*\(/);
  assert.match(source, /profileResult\.status === 'rejected' && coreResult\.status === 'rejected'/);
});
