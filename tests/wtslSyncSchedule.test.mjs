import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const config = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
);

test('player rankings refresh twice hourly without accelerating tournament or stats syncs', () => {
  const schedules = new Map(config.crons.map(({ path, schedule }) => [path, schedule]));

  assert.equal(schedules.get('/api/sync/wtsl-players'), '10,40 * * * *');
  assert.equal(schedules.get('/api/sync/wtsl-tournaments'), '0 * * * *');
  assert.equal(schedules.get('/api/sync/wtsl-stats'), '0 3 * * *');
  assert.equal(schedules.has('/api/sync/wtsl'), false);
});
