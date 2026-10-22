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
    if (name === '@/lib/liveScores') {
      return {
        getLiveWtslMatchForPlayers: async () => null,
        canonicalizeRankedDmoPlayers: async (players) => players,
      };
    }
    if (name === '@/lib/siteSnapshots') return { readSiteSnapshot: async () => null };
    if (name === '@/lib/liveDmoStorage') {
      return {
        cleanupExpiredLiveDmoBroadcasts: async () => {},
        isLiveDmoReplayPath: (value) => typeof value === 'string' && value.startsWith('dmo-live-replays/'),
      };
    }
    throw new Error(`Unexpected route dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

function request(body, path = '/api/live-dmo', method = 'POST') {
  return new Request(`https://forum.test${path}`, {
    method,
    headers: {
      Origin: 'https://forum.test',
      'X-Forwarded-Host': 'forum.test',
      'X-Forwarded-Proto': 'https',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };
const liveMessageUrl = 'https://discord.com/channels/786583939028090881/1293144531855872074/1561378343230906484';
const validMessage = {
  id: '1561378343230906484',
  channel_id: '1293144531855872074',
  author: { id: 'linked-member', bot: false },
  content: 'Live stream: https://youtu.be/dQw4w9WgXcQ',
  embeds: [],
};

test('a signed-in member can start multiple broadcasts from their linked Discord stream posts', async () => {
  const inserts = [];
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'next': { NextResponse: nextServer.NextResponse },
    'node:crypto': { randomUUID: () => `broadcast-${inserts.length}` },
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'linked-member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveBroadcast': {
      parseDiscordMessageUrl: (value) => value === liveMessageUrl
        ? { guildId: '786583939028090881', channelId: '1293144531855872074', messageId: '1561378343230906484' }
        : null,
      streamLinksInDiscordMessage: (message) => message.content.includes('youtu.be')
        ? [{ provider: 'youtube', id: 'dQw4w9WgXcQ', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' }]
        : [],
    },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        inserts.push({ query: strings.join('?'), values });
        return [];
      },
    },
  });
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  globalThis.fetch = async () => Response.json(validMessage);
  try {
    const first = await route.POST(request({ hasDmo: false, discordMessageUrl: liveMessageUrl, players: ['Alpha', 'Beta'] }));
    const second = await route.POST(request({ hasDmo: false, discordMessageUrl: liveMessageUrl, players: ['Alpha', 'Beta'] }));
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(inserts.filter((item) => item.query.includes('INSERT INTO dmo_live_broadcasts')).length, 2);
    assert.equal(inserts.some((item) => item.query.includes("status='live'")), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
  }
});

test('automatic broadcasts require a confirmed WTSL live match and retain its official labels', async () => {
  const inserts = [];
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': { randomUUID: () => 'automatic-broadcast' },
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'linked-member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveScores': {
      getLiveWtslMatchForPlayers: async (players) => (
        players[0] === 'Alpha' && players[1] === 'Beta'
          ? { name: 'Alpha vs Beta', bestOf: 3 }
          : null
      ),
    },
    '@/lib/siteSnapshots': {
      readSiteSnapshot: async () => ({
        checkedAt: new Date().toISOString(),
        payload: { publicOpen: [{ tour: 'TE4', first_name: 'Beta', second_name: 'Alpha' }] },
      }),
    },
    '@/lib/liveBroadcast': {
      isLikelyOfficialWtslMatch: () => true,
      parseDiscordMessageUrl: () => null,
      streamLinksInDiscordMessage: () => [],
    },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        inserts.push({ query: strings.join('?'), values });
        return [];
      },
    },
  });
  const response = await route.POST(request({
    hasDmo: true,
    players: ['Alpha', 'Beta'],
    mode: 'auto',
    bestOf: 3,
    officialByBroadcaster: true,
  }));
  assert.equal(response.status, 201);
  const insertedBroadcast = inserts.find((item) => item.query.includes('INSERT INTO dmo_live_broadcasts'));
  const storedPayload = insertedBroadcast?.values.find((value) => typeof value === 'string' && value.includes('"mode":"auto"'));
  assert.ok(storedPayload);
  assert.equal(JSON.parse(storedPayload).bestOf, 3);
  assert.equal(JSON.parse(storedPayload).hasDmo, true);
  assert.equal(JSON.parse(storedPayload).officialByBroadcaster, true);
  assert.equal(JSON.parse(storedPayload).likelyOfficial, true);
});

test('automatic broadcasts are rejected when the exact player pair is not live', async () => {
  let databaseCalls = 0;
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': require('node:crypto'),
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'linked-member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveScores': { getLiveWtslMatchForPlayers: async () => null },
    '@/lib/liveBroadcast': { parseDiscordMessageUrl: () => null, streamLinksInDiscordMessage: () => [] },
    '@/lib/db': { sql: async () => { databaseCalls += 1; return []; } },
  });
  const response = await route.POST(request({
    hasDmo: true,
    players: ['Offline One', 'Offline Two'],
    mode: 'auto',
    bestOf: 3,
  }));
  assert.equal(response.status, 409);
  assert.equal(databaseCalls, 0);
});

test('manual DMO replay stores ranked player names without requiring a current live match', async () => {
  const inserts = [];
  let liveFeedLookups = 0;
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': { randomUUID: () => 'historical-replay' },
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'linked-member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveScores': {
      getLiveWtslMatchForPlayers: async () => {
        liveFeedLookups += 1;
        return null;
      },
      canonicalizeRankedDmoPlayers: async () => ['Squeaky', 'Player Two'],
    },
    '@/lib/siteSnapshots': {
      readSiteSnapshot: async () => ({
        checkedAt: new Date().toISOString(),
        payload: { publicOpen: [{ tour: 'TE4', first_name: 'Player Two', second_name: 'Squeaky' }] },
      }),
    },
    '@/lib/liveBroadcast': {
      isLikelyOfficialWtslMatch: (players) => players[0] === 'Squeaky',
      parseDiscordMessageUrl: () => null,
      streamLinksInDiscordMessage: () => [],
    },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        inserts.push({ query: strings.join('?'), values });
        return [];
      },
    },
  });
  const response = await route.POST(request({
    hasDmo: true,
    replay: true,
    replaySpeed: 2,
    players: ['[Fake] Squeaky', 'Player Two'],
    mode: 'manual',
    bestOf: 3,
  }));
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.deepEqual(body.players, ['Squeaky', 'Player Two']);
  assert.equal(body.replay, true);
  assert.equal(body.replaySpeed, 2);
  assert.equal(liveFeedLookups, 0);
  const insertedBroadcast = inserts.find((item) => item.query.includes('INSERT INTO dmo_live_broadcasts'));
  const storedPayload = insertedBroadcast?.values.find((value) => typeof value === 'string' && value.includes('"mode":"manual"'));
  assert.ok(storedPayload);
  assert.deepEqual(JSON.parse(storedPayload).players, ['Squeaky', 'Player Two']);
  assert.equal(JSON.parse(storedPayload).replay, true);
  assert.equal(JSON.parse(storedPayload).replaySpeed, 2);
  assert.equal(JSON.parse(storedPayload).likelyOfficial, true);
});

test('a replay cannot be started without a DMO and parsed player names', async () => {
  let databaseCalls = 0;
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': require('node:crypto'),
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'linked-member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveBroadcast': {
      isLikelyOfficialWtslMatch: () => false,
      parseDiscordMessageUrl: () => null,
      streamLinksInDiscordMessage: () => [],
    },
    '@/lib/db': { sql: async () => { databaseCalls += 1; return []; } },
  });
  const response = await route.POST(request({
    hasDmo: false,
    replay: true,
    mode: 'manual',
  }));
  assert.equal(response.status, 400);
  assert.equal(databaseCalls, 0);

  const manualDmoResponse = await route.POST(request({
    hasDmo: true,
    replay: false,
    mode: 'manual',
    players: ['Squeaky', 'Player Two'],
  }));
  assert.equal(manualDmoResponse.status, 400);
  assert.equal(databaseCalls, 0);
});

test('guest broadcast attempts are rejected before database access', async () => {
  let databaseCalls = 0;
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': require('node:crypto'),
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => null },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveBroadcast': { parseDiscordMessageUrl: () => null, streamLinksInDiscordMessage: () => [] },
    '@/lib/db': { sql: async () => { databaseCalls += 1; return []; } },
  });
  const response = await route.POST(request({ hasDmo: true }));
  assert.equal(response.status, 401);
  assert.equal(databaseCalls, 0);
});

test('a Discord message from a different linked account cannot be broadcast', async () => {
  let inserts = 0;
  const route = loadRoute('app/api/live-dmo/route.ts', {
    'next/server': nextServer,
    'node:crypto': require('node:crypto'),
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'another-member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/liveBroadcast': {
      parseDiscordMessageUrl: () => ({ guildId: '786583939028090881', channelId: '1293144531855872074', messageId: validMessage.id }),
      streamLinksInDiscordMessage: () => [{ provider: 'youtube', id: 'dQw4w9WgXcQ', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' }],
    },
    '@/lib/db': { sql: async () => { inserts += 1; return []; } },
  });
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
  globalThis.fetch = async () => Response.json(validMessage);
  try {
    const response = await route.POST(request({ hasDmo: false, discordMessageUrl: liveMessageUrl }));
    assert.equal(response.status, 403);
    assert.equal(inserts, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
  }
});

test('broadcast owners can heartbeat and end only their own active broadcast', async () => {
  const id = '7e09e922-44c3-49d7-8211-48f13b8b865a';
  const queries = [];
  const route = loadRoute('app/api/live-dmo/[id]/route.ts', {
    'next/server': nextServer,
    'zod': require('zod'),
    '@/lib/auth': { getSession: async () => ({ discordId: 'broadcast-owner', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        queries.push({ text: strings.join('?'), values });
        return [{ id }];
      },
    },
  });
  const context = { params: Promise.resolve({ id }) };
  const heartbeat = await route.PATCH(request({ sequence: 1 }, `/api/live-dmo/${id}`, 'PATCH'), context);
  assert.equal(heartbeat.status, 200);
  assert.match(queries[0].text, /owner_discord_id=\?/);
  assert.match(queries[0].text, /sequence < \?/);

  const ended = await route.DELETE(request(undefined, `/api/live-dmo/${id}`, 'DELETE'), context);
  assert.equal(ended.status, 200);
  assert.match(queries[1].text, /owner_discord_id=\?.*OR \?/s);
  assert.match(queries[1].text, /status='live'/);
});

test('homepage displays video links only when a signed-in viewer has a matching broadcast', () => {
  const liveScores = readFileSync(new URL('../components/LiveScores.tsx', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../components/DmoLiveViewer.tsx', import.meta.url), 'utf8');
  assert.match(liveScores, /sameLiveMatch\(/);
  assert.match(liveScores, /live-broadcast-match-link/);
  assert.match(liveScores, /if \(!signedIn\) return/);
  assert.match(viewer, /body\?\.broadcasts/);
});

test('verified replay openings can be shown before the first point; other DMO broadcasts still require one', async () => {
  const timestamp = new Date('2026-10-22T10:00:00Z');
  const rows = [
    { id: 'auto-no-snapshot', payload: { hasDmo: true, mode: 'auto' } },
    { id: 'auto-no-point', payload: { hasDmo: true, mode: 'auto', snapshot: { pointCount: 0 } } },
    {
      id: 'replay-no-point',
      payload: {
        hasDmo: true,
        mode: 'manual',
        replay: true,
        snapshot: { version: 1, frameCount: 10, pointCount: 0, players: ['Replay One', 'Replay Two'], court: [] },
      },
    },
    {
      id: 'replay-no-opening-frame',
      payload: {
        hasDmo: true,
        mode: 'manual',
        replay: true,
        snapshot: { version: 1, frameCount: 9, pointCount: 0, players: ['Replay One', 'Replay Two'], court: [] },
      },
    },
    { id: 'legacy-no-point', payload: { version: 1, pointCount: 0, players: ['Old One', 'Old Two'] } },
    { id: 'auto-parsed', payload: { hasDmo: true, mode: 'auto', snapshot: { pointCount: 1, players: ['Alpha', 'Beta'] } } },
    { id: 'replay-parsed', payload: { hasDmo: true, mode: 'manual', replay: true, snapshot: { pointCount: 1, players: ['Gamma', 'Delta'] } } },
    {
      id: 'stream-only',
      payload: {
        hasDmo: false,
        mode: 'manual',
        replay: false,
        stream: { provider: 'youtube', id: 'dQw4w9WgXcQ', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' },
      },
    },
  ].map((row) => ({
    ...row,
    owner_discord_id: 'broadcast-owner',
    status: 'live',
    sequence: 1,
    started_at: timestamp,
    updated_at: timestamp,
    owner_name: 'Tennis fan',
    stale: false,
  }));
  const route = loadRoute('app/api/live-dmo/current/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ id: '22' }) },
    '@/lib/db': { sql: async () => rows },
    '@/lib/te4DmoLive': {
      hasCompletedDmoPoints: (snapshot) => Boolean(snapshot && Number.isInteger(snapshot.pointCount) && snapshot.pointCount > 0),
    },
  });
  const response = await route.GET(request(undefined, '/api/live-dmo/current', 'GET'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.broadcasts.map((broadcast) => broadcast.id), [
    'replay-no-point',
    'auto-parsed',
    'replay-parsed',
    'stream-only',
  ]);
  const host = readFileSync(new URL('../components/DmoLiveHost.tsx', import.meta.url), 'utf8');
  assert.match(host, /hasCompletedDmoPoints\(current\)/);
  assert.match(host, /hasCompletedDmoPoints\(matchedSnapshot\)/);
});
