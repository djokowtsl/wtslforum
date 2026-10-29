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
    if (name === '@/lib/liveScores') return { getLiveBroadcastScoreFeed: async () => null };
    if (name === '@/lib/liveBroadcastScore') return { scoreForLiveBroadcast: () => null };
    if (name === '@/lib/liveRequestSecurity') {
      return { isSameSiteMutation: (request) => request.headers.get('origin') === 'https://forum.test' };
    }
    if (name === '@/lib/te4DmoLive') {
      return {
        hasCompletedDmoPoints: (snapshot) => Boolean(snapshot && Number.isInteger(snapshot.pointCount) && snapshot.pointCount > 0),
      };
    }
    if (name === '@/lib/liveDmoStorage') {
      return {
        cleanupExpiredLiveDmoBroadcasts: async () => {},
        isLiveDmoReplayPath: (value) => typeof value === 'string' && value.startsWith('dmo-live-replays/'),
      };
    }
    if (name === '@/lib/liveBroadcastAnnouncements') {
      return { finishLiveBroadcastAnnouncement: async () => {} };
    }
    if (name === 'zod') return require('zod');
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
  let cleanupCalls = 0;
  const route = loadRoute('app/api/admin/dmo-live/route.ts', {
    'node:crypto': { randomUUID: () => '7e09e922-44c3-49d7-8211-48f13b8b865a' },
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ discordId: 'admin', isAdmin: true }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation },
    '@/lib/liveDmoStorage': { cleanupExpiredLiveDmoBroadcasts: async () => { cleanupCalls += 1; } },
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
  assert.equal(cleanupCalls, 1);
  assert.equal(queries.length, 2);
  assert.match(queries[0].text, /status='live'/);
  assert.match(queries[1].text, /INSERT INTO dmo_live_broadcasts/);
});

test('signed-in viewers can fetch the full private point log', async () => {
  const points = [
    { number: 1, scoreLabel: '0-0(15-0)', server: 1, winner: 1, rallyHits: 0, faults: 0 },
    { number: 2, scoreLabel: '0-0(15-15)', server: 2, winner: 2, rallyHits: 3, faults: 1 },
  ];
  const route = loadRoute('app/api/live-dmo/[id]/points/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ discordId: 'member', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation },
    '@/lib/db': {
      sql: async () => [{ point_log: points }],
    },
  });
  const response = await route.GET(
    validRequest('/api/live-dmo/7e09e922-44c3-49d7-8211-48f13b8b865a/points', 'GET'),
    { params: Promise.resolve({ id: '7e09e922-44c3-49d7-8211-48f13b8b865a' }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { points });

  let guestDatabaseCalls = 0;
  const guestRoute = loadRoute('app/api/live-dmo/[id]/points/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => null },
    '@/lib/liveRequestSecurity': { isSameSiteMutation },
    '@/lib/db': { sql: async () => { guestDatabaseCalls += 1; return []; } },
  });
  const guestResponse = await guestRoute.GET(
    validRequest('/api/live-dmo/7e09e922-44c3-49d7-8211-48f13b8b865a/points', 'GET'),
    { params: Promise.resolve({ id: '7e09e922-44c3-49d7-8211-48f13b8b865a' }) },
  );
  assert.equal(guestResponse.status, 401);
  assert.equal(guestDatabaseCalls, 0);
});

test('point log batches are same-site, validated, owner-only updates', async () => {
  const queries = [];
  const points = [
    { number: 1, scoreLabel: '0-0(15-0)', server: 1, winner: 1, rallyHits: 0, faults: 0 },
  ];
  const route = loadRoute('app/api/live-dmo/[id]/points/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ discordId: 'owner', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        queries.push({ text: strings.join('?'), values });
        return [{ id: '7e09e922-44c3-49d7-8211-48f13b8b865a' }];
      },
    },
  });
  const request = new Request('https://forum.test/api/live-dmo/7e09e922-44c3-49d7-8211-48f13b8b865a/points', {
    method: 'PATCH',
    headers: {
      Origin: 'https://forum.test',
      'X-Forwarded-Host': 'forum.test',
      'X-Forwarded-Proto': 'https',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ points }),
  });
  const response = await route.PATCH(
    request,
    { params: Promise.resolve({ id: '7e09e922-44c3-49d7-8211-48f13b8b865a' }) },
  );
  assert.equal(response.status, 200);
  assert.match(queries[0].text, /'pointLog'/);
  assert.match(queries[0].text, /jsonb_array_elements/);
  assert.ok(queries[0].values.includes('owner'));
  assert.ok(queries[0].values.includes(JSON.stringify(points)));
});

test('live snapshot updates merge their recent points into the retained point log', async () => {
  const queries = [];
  const recentPoints = [
    { number: 1, scoreLabel: '0-0(15-0)', server: 1, winner: 1, rallyHits: 0, faults: 0 },
  ];
  const snapshot = {
    version: 1,
    filename: 'match.dmo',
    stadium: null,
    players: ['One', 'Two'],
    frameCount: 10,
    courtFrameCount: 10,
    pointCount: 1,
    bestOf: 3,
    score: {
      sets: [],
      games: [0, 0],
      points: [1, 0],
      pointText: ['15', '0'],
      tiebreak: false,
      server: 1,
    },
    currentPoint: { number: 2, server: 2, rallyHits: 0, serveSpeedKmh: null, inProgress: false },
    winChance: [0.5, 0.5],
    winHistory: [0.5],
    stats: [0, 1].map(() => ({
      servicePoints: 1,
      servicePointsWon: 1,
      serviceWinRate: 1,
      pointsWon: 1,
      firstServeFaults: 0,
      acesOrUnreturned: 0,
    })),
    recentPoints,
    court: [[0, 0, 0, 0, 0, 0, 0]],
    courtFrameIndices: [0],
  };
  const route = loadRoute('app/api/live-dmo/[id]/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ discordId: 'owner', isAdmin: false }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        queries.push({ text: strings.join('?'), values });
        return [{ id: '7e09e922-44c3-49d7-8211-48f13b8b865a' }];
      },
    },
  });
  const request = new Request('https://forum.test/api/live-dmo/7e09e922-44c3-49d7-8211-48f13b8b865a', {
    method: 'PATCH',
    headers: {
      Origin: 'https://forum.test',
      'X-Forwarded-Host': 'forum.test',
      'X-Forwarded-Proto': 'https',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sequence: 1, snapshot }),
  });
  const response = await route.PATCH(
    request,
    { params: Promise.resolve({ id: '7e09e922-44c3-49d7-8211-48f13b8b865a' }) },
  );
  assert.equal(response.status, 200);
  assert.match(queries[0].text, /'pointLog'/);
  assert.match(queries[0].text, /jsonb_array_elements/);
  assert.ok(queries[0].values.includes(JSON.stringify(recentPoints)));
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
        assert.match(strings.join(' '), /SELECT b\.id/);
        return [
          {
            id: 'broadcast-id',
            owner_discord_id: 'member',
            owner_name: 'Member',
            status: 'live',
            payload: { snapshot: { players: ['One', 'Two'], version: 1, pointCount: 1 }, players: ['One', 'Two'] },
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
            payload: {
              stream: { provider: 'youtube', id: 'dQw4w9WgXcQ', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ' },
              snapshot: { players: ['Three', 'Four'], version: 1, pointCount: 1 },
              mode: 'manual',
              replay: true,
              replayDataPath: 'dmo-live-replays/7e09e922-44c3-49d7-8211-48f13b8b865a-5409358e-55c8-4e8a-a74d-e1edbfb751d5.json',
              replaySpeed: 4,
            },
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
    snapshot: { players: ['One', 'Two'], version: 1, pointCount: 1 },
    stream: null,
    sourceMessageUrl: null,
    broadcastMode: 'manual',
    isWta: false,
    replay: false,
    replayDataReady: false,
    replaySpeed: 1,
    officialByBroadcaster: false,
    officialByTournament: false,
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
  assert.equal(body.broadcasts[1].replay, true);
  assert.equal(body.broadcasts[1].replayDataReady, true);
  assert.equal(body.broadcasts[1].replaySpeed, 4);
});

test('full replay files require sign-in and are served from the private store', async () => {
  const originalStoreId = process.env.MODERATION_BLOB_STORE_ID;
  const id = '7e09e922-44c3-49d7-8211-48f13b8b865a';
  const pathname = `dmo-live-replays/${id}-5409358e-55c8-4e8a-a74d-e1edbfb751d5.json`;
  const blobCalls = [];
  process.env.MODERATION_BLOB_STORE_ID = 'private-replay-store';
  try {
    const guestRoute = loadRoute('app/api/live-dmo/[id]/replay/route.ts', {
      'next/server': nextServer,
      '@vercel/blob': { get: async () => { throw new Error('Guests must not fetch blobs.'); } },
      '@/lib/auth': { getSession: async () => null },
      '@/lib/db': { sql: async () => { throw new Error('Guests must not query replay rows.'); } },
    });
    const guestResponse = await guestRoute.GET(new Request(`https://forum.test/api/live-dmo/${id}/replay`), {
      params: Promise.resolve({ id }),
    });
    assert.equal(guestResponse.status, 401);

    const memberRoute = loadRoute('app/api/live-dmo/[id]/replay/route.ts', {
      'next/server': nextServer,
      '@vercel/blob': {
        get: async (...args) => {
          blobCalls.push(args);
          return {
            statusCode: 200,
            blob: { size: 13 },
            stream: new Response('{"viewer":{}}').body,
          };
        },
      },
      '@/lib/auth': { getSession: async () => ({ discordId: 'member', isAdmin: false }) },
      '@/lib/db': {
        sql: async () => [{
          payload: { mode: 'manual', replay: true, replayDataPath: pathname },
        }],
      },
    });
    const response = await memberRoute.GET(new Request(`https://forum.test/api/live-dmo/${id}/replay`), {
      params: Promise.resolve({ id }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(await response.text(), '{"viewer":{}}');
    assert.deepEqual(blobCalls, [[pathname, {
      access: 'private',
      storeId: 'private-replay-store',
      useCache: false,
    }]]);
  } finally {
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});

test('expired live broadcasts are marked ended and update their Discord announcements', async () => {
  const id = '7e09e922-44c3-49d7-8211-48f13b8b865a';
  const payload = {
    discordAnnouncement: { channelId: '1562898541238554765', messageId: 'discord-message-expired' },
  };
  const queries = [];
  const finished = [];
  const storage = loadRoute('lib/liveDmoStorage.ts', {
    '@vercel/blob': { del: async () => {} },
    '@/lib/liveBroadcastAnnouncements': {
      finishLiveBroadcastAnnouncement: async (input) => finished.push(input),
    },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        const query = strings.join('?');
        queries.push({ query, values });
        if (query.includes('SELECT id')) {
          return [{ id, owner_discord_id: 'broadcast-owner', status: 'live', payload, replay_path: null }];
        }
        if (query.includes('UPDATE dmo_live_broadcasts')) {
          return [{ id, owner_discord_id: 'broadcast-owner', payload }];
        }
        return [];
      },
    },
  });

  await storage.cleanupExpiredLiveDmoBroadcasts();

  assert.equal(queries.length, 2);
  assert.match(queries[0].query, /status, payload/);
  assert.match(queries[1].query, /status='ended'/);
  assert.match(queries[1].query, /INTERVAL '15 minutes'/);
  assert.equal(queries.some(({ query }) => query.includes('DELETE FROM dmo_live_broadcasts')), false);
  assert.deepEqual(finished, [{
    id,
    ownerDiscordId: 'broadcast-owner',
    payload,
  }]);
});

test('expired private replay blobs are deleted before their database rows', async () => {
  const originalStoreId = process.env.MODERATION_BLOB_STORE_ID;
  const replayPath = 'dmo-live-replays/7e09e922-44c3-49d7-8211-48f13b8b865a-5409358e-55c8-4e8a-a74d-e1edbfb751d5.json';
  const queries = [];
  const blobDeletes = [];
  process.env.MODERATION_BLOB_STORE_ID = 'private-replay-store';
  try {
    const storage = loadRoute('lib/liveDmoStorage.ts', {
      '@vercel/blob': { del: async (...args) => blobDeletes.push(args) },
      '@/lib/db': {
        sql: async (strings, ...values) => {
          const query = strings.join('?');
          queries.push({ query, values });
          return query.includes('SELECT id')
            ? [
              { id: '7e09e922-44c3-49d7-8211-48f13b8b865a', status: 'ended', replay_path: replayPath },
              { id: 'c94d7cb5-cc07-4de3-93f4-0f3375e30136', status: 'ended', replay_path: null },
            ]
            : [];
        },
      },
    });
    assert.equal(storage.isLiveDmoReplayPath(replayPath), true);
    assert.equal(storage.isLiveDmoReplayPath('dmo-live-replays/../../private.json'), false);
    await storage.cleanupExpiredLiveDmoBroadcasts();
    assert.deepEqual(blobDeletes, [[replayPath, { storeId: 'private-replay-store' }]]);
    assert.equal(queries.filter(({ query }) => query.includes('DELETE FROM dmo_live_broadcasts')).length, 2);
  } finally {
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});
