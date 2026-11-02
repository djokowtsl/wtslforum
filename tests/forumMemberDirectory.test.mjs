import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

function loadDirectory(sql) {
  const source = readFileSync(new URL('../lib/member-directory.ts', import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === '@/lib/db') return { sql };
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

test('public directory limits display data and resolves approved profiles with search and pagination', async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join(' ? ');
    calls.push({ text, values });
    if (text.includes('COUNT(*)')) return [{ total: 65 }];
    return [{
      id: 11,
      display_name: 'Serena',
      avatar_url: 'https://cdn.test/avatar.png',
      profile_player_id: 'player-11',
      profile_tour: 'TE4',
    }];
  };
  const { listForumMembers } = loadDirectory(sql);

  const result = await listForumMembers('  Serena  ', 3, 20);

  assert.deepEqual(result, {
    members: [{
      id: 11,
      display_name: 'Serena',
      avatar_url: 'https://cdn.test/avatar.png',
      profile_player_id: 'player-11',
      profile_tour: 'TE4',
    }],
    total: 65,
    page: 3,
    pageCount: 4,
  });
  assert.deepEqual(calls[0].values, ['Serena', 'Serena']);
  assert.deepEqual(calls[1].values, ['Serena', 'Serena', 20, 40]);
  assert.match(calls[1].text, /SELECT u\.id, u\.display_name, u\.avatar_url/);
  assert.match(calls[1].text, /LEFT JOIN LATERAL/);
  assert.match(calls[1].text, /c\.status = 'approved'/);
  assert.match(calls[1].text, /JOIN wtsl_players p/);
  assert.match(calls[1].text, /CASE WHEN c\.tour = 'TE4' THEN 0/);
  assert.match(calls[1].text, /WHEN c\.id = u\.default_player_claim_id THEN 1/);
  assert.match(calls[1].text, /ORDER BY LOWER\(u\.display_name\), u\.id/);
  assert.doesNotMatch(calls[1].text, /discord_id|username|email|u\.status/i);
});

test('directory clamps page and page size and caps search input', async () => {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join(' ? ');
    calls.push({ text, values });
    return text.includes('COUNT(*)') ? [{ total: 5 }] : [];
  };
  const { listForumMembers } = loadDirectory(sql);

  const result = await listForumMembers('x'.repeat(100), 999, 500);

  assert.equal(result.page, 1);
  assert.equal(result.pageCount, 1);
  assert.equal(calls[0].values[0].length, 80);
  assert.deepEqual(calls[1].values.slice(-2), [60, 0]);
});

test('members are linked from desktop and mobile navigation and are publicly browsable', () => {
  const header = readFileSync(new URL('../components/ForumHeader.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/members/page.tsx', import.meta.url), 'utf8');
  const footer = readFileSync(new URL('../components/ForumFooter.tsx', import.meta.url), 'utf8');

  assert.match(header, /href: '\/members', label: 'Members'/);
  assert.match(footer, /href="\/members">Members/);
  assert.match(page, /export default async function MembersPage/);
  assert.match(page, /listForumMembers\(query, requestedPage, FORUM_MEMBER_PAGE_SIZE\)/);
  assert.doesNotMatch(page, /redirect\(/);
  assert.match(page, /member\.profile_player_id/);
  assert.match(page, /href=\{profileHref\}/);
  assert.match(page, /\/players\/\$\{encodeURIComponent\(member\.profile_player_id\)\}/);
  assert.match(page, /href=\{`\/messages\/\$\{member\.id\}`\}/);
});
