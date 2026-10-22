import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [adminPage, adminPanel, adminRoute, publicPage, awardsLibrary] = await Promise.all([
  read('../app/admin/awards/page.tsx'),
  read('../components/AwardAdminPanel.tsx'),
  read('../app/api/admin/awards/route.ts'),
  read('../app/awards/page.tsx'),
  read('../lib/awards.ts'),
]);

test('Forum admin awards page does not load or display vote tallies', () => {
  assert.doesNotMatch(adminPage, /getTally|getWriteInTally|tally|write_ins/i);
  assert.doesNotMatch(adminPanel, /tally|write_ins|vote count|responses/i);
  assert.doesNotMatch(awardsLibrary, /export async function getTally|export async function getWriteInTally/);
});

test('Forum public awards page does not display poll totals', () => {
  assert.doesNotMatch(publicPage, /getTally|getWriteInTally|tally|voteCount|responseCount/i);
});

test('admin sync and CSV import endpoints do not return vote counts or response rows', () => {
  assert.doesNotMatch(adminRoute, /\.\.\.result/);
  assert.doesNotMatch(adminRoute, /NextResponse\.json\(\{\s*ok:\s*true,\s*imported\s*\}\)/);
  assert.match(adminRoute, /return NextResponse\.json\(\{ ok: true \}\);/);
});
