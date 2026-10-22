import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadRoute(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = require('next/dist/build/swc').transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected route dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

function validRequest(path, method = 'POST') {
  return new Request(`https://forum.test${path}`, {
    method,
    headers: {
      Origin: 'https://forum.test',
      'X-Forwarded-Host': 'forum.test',
      'X-Forwarded-Proto': 'https',
    },
  });
}

const isSameSiteMutation = (request) => request.headers.get('origin') === 'https://forum.test';
const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };

test('only admins can start a live DMO broadcast', async () => {
  for (const user of [null, { discordId: 'member', isAdmin: false }]) {
    let databaseCalls = 0;
    const route = loadRoute('app/api/admin/dmo-live/route.ts', {
      'next/server': nextServer,
      '@/lib/auth': { getSession: async () => user },
      '@/lib/liveRequestSecurity': { isSameSiteMutation },
      '@/lib/db': { sql: async () => { databaseCalls += 1; return []; } },
    });
    const response = await route.POST(validRequest('/api/admin/dmo-live'));
    assert.equal(response.status, 403);
    assert.equal(databaseCalls, 0);
  }
});

test('admins can create a broadcast after expired rows are cleared', async () => {
  const queries = [];
  const route = loadRoute('app/api/admin/dmo-live/route.ts', {
    'node:crypto': { randomUUID: () => '7e09e922-44c3-49d7-8211-48f13b8b865a' },
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ discordId: 'admin', isAdmin: true }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        queries.push({ text: strings.join('?'), values });
        return [];
      },
    },
  });
  const response = await route.POST(validRequest('/api/admin/dmo-live'));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, '7e09e922-44c3-49d7-8211-48f13b8b865a');
  assert.equal(queries.length, 3);
  assert.match(queries[0].text, /DELETE FROM dmo_live_broadcasts WHERE expires_at <= NOW/);
  assert.match(queries[1].text, /status='live'/);
  assert.match(queries[2].text, /INSERT INTO dmo_live_broadcasts/);
});

test('signed-in members can read broadcasts while guests cannot', async () => {
  let databaseCalls = 0;
  const route = loadRoute('app/api/live-dmo/current/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => null },
    '@/lib/db': { sql: async () => { databaseCalls += 1; return []; } },
  });
  const guestResponse = await route.GET();
  assert.equal(guestResponse.status, 401);
  assert.equal(databaseCalls, 0);

  const startedAt = new Date('2026-10-20T12:00:00Z');
  const updatedAt = new Date('2026-10-20T12:01:00Z');
  const memberRoute = loadRoute('app/api/live-dmo/current/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ discordId: 'member', isAdmin: false }) },
    '@/lib/db': {
      sql: async (strings) => {
        databaseCalls += 1;
        assert.match(strings.join(' '), /DELETE FROM dmo_live_broadcasts/);
        return [
          {
            id: 'broadcast-id',
            owner_discord_id: 'member',
            owner_name: 'Member',
            status: 'live',
            payload: { snapshot: { players: ['One', 'Two'], version: 1 }, players: ['One', 'Two'] },
            sequence: 4,
            started_at: startedAt,
            updated_at: updatedAt,
            stale: false,
          },
          {
            id: 'second-broadcast',
            owner_discord_id: 'other-member',
            owner_name: 'Other',
            status: 'live',
            payload: { stream: { provider: 'youtube', id: 'dQw4w9WgXcQ', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' } },
            sequence: 1,
            started_at: startedAt,
            updated_at: updatedAt,
            stale: false,
          },
        ];
      },
    },
  });
  const memberResponse = await memberRoute.GET();
  assert.equal(memberResponse.status, 200);
  const body = await memberResponse.json();
  assert.equal(body.broadcasts.length, 2);
  assert.deepEqual(body.broadcasts[0], {
    id: 'broadcast-id',
    status: 'live',
    ownerName: 'Member',
    snapshot: { players: ['One', 'Two'], version: 1 },
    stream: null,
    sourceMessageUrl: null,
    broadcastMode: 'manual',
    officialByBroadcaster: false,
    likelyOfficial: false,
    players: ['One', 'Two'],
    sequence: 4,
    startedAt: startedAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    stale: false,
  });
  assert.deepEqual(body.broadcasts[1].stream, {
    provider: 'youtube',
    id: 'dQw4w9WgXcQ',
    sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
  });
});
