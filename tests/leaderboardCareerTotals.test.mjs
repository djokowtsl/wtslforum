import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const statsSource = await readFile(new URL('../lib/stats.ts', import.meta.url), 'utf8');
const leaderboardStart = statsSource.indexOf('export async function leaderboard(');
const nextExport = statsSource.indexOf('\nexport async function ', leaderboardStart + 1);
const leaderboardSource = statsSource.slice(
  leaderboardStart,
  nextExport === -1 ? undefined : nextExport,
);

assert.notEqual(leaderboardStart, -1, 'leaderboard query should be present');

test('career leaderboard uses the official summary for matches, record, win percentage, and eligibility', () => {
  assert.match(leaderboardSource, /COALESCE\(s\.matches,0\) matches/);
  assert.match(leaderboardSource, /COALESCE\(s\.wins,0\) wins/);
  assert.match(leaderboardSource, /COALESCE\(s\.losses,0\) losses/);
  assert.match(leaderboardSource, /100\.0\*s\.wins\/s\.matches/);
  assert.match(
    leaderboardSource,
    /COALESCE\(s\.matches,0\) >= \$\{LEADERBOARD_MIN_MATCHES\}/,
  );
  assert.doesNotMatch(leaderboardSource, /FROM\s+match_stats|match_counts AS/);
});
