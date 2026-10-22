import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const broadcastId = '7e09e922-44c3-49d7-8211-48f13b8b865a';
const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };

function loadRoute(mocks) {
  const source = readFileSync(new URL('../app/api/live-dmo/[id]/comments/route.ts', import.meta.url), 'utf8');
  const { code } = require('next/dist/build/swc').transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('node:') || name === 'zod') return require(name);
    throw new Error(`Unexpected route dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

function loadModerationRoute(mocks) {
  const source = readFileSync(new URL('../app/api/admin/moderation/review/route.ts', import.meta.url), 'utf8');
  const { code } = require('next/dist/build/swc').transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected moderation dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

function request(method, body, origin = 'https://forum.test') {
  return new Request(`https://forum.test/api/live-dmo/${broadcastId}/comments`, {
    method,
    headers: {
      Origin: origin,
      'X-Forwarded-Host': 'forum.test',
      'X-Forwarded-Proto': 'https',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function routeMocks({ user = { id: '22', username: 'Fan' }, decision = 'approved', sql } = {}) {
  class ModerationUnavailableError extends Error {}
  return {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => user },
    '@/lib/db': { sql },
    '@/lib/moderation': {
      ModerationUnavailableError,
      moderateTextAndImages: async () => ({ status: decision, reason: decision === 'pending' ? 'uncertain' : null }),
    },
    '@/lib/spoilers': { spoilerMarkupError: () => null },
    '@/lib/liveRequestSecurity': {
      isSameSiteMutation: (req) => req.headers.get('origin') === 'https://forum.test',
    },
  };
}

test('guests cannot read live comments or trigger a database query', async () => {
  let calls = 0;
  const route = loadRoute(routeMocks({ user: null, sql: async () => { calls += 1; return []; } }));
  const response = await route.GET(request('GET'), { params: Promise.resolve({ id: broadcastId }) });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test('signed-in viewers receive only approved comments for a non-expired broadcast', async () => {
  const queries = [];
  const route = loadRoute(routeMocks({
    sql: async (strings) => {
      const query = strings.join(' ');
      queries.push(query);
      if (query.includes('SELECT id FROM dmo_live_broadcasts')) return [{ id: broadcastId }];
      if (query.includes('SELECT c.id, c.body')) {
        return [{ id: 9, body: 'Good match', author_name: 'Fan', created_at: new Date('2026-10-22T10:00:00Z') }];
      }
      return [];
    },
  }));
  const response = await route.GET(request('GET'), { params: Promise.resolve({ id: broadcastId }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).comments, [{
    id: '9',
    body: 'Good match',
    authorName: 'Fan',
    createdAt: '2026-10-22T10:00:00.000Z',
  }]);
  assert.match(queries[0], /expires_at > NOW/);
  assert.match(queries[1], /moderation_status='approved'/);
});

test('same-site signed-in comments are screened and stored for moderator review when uncertain', async () => {
  const queries = [];
  const route = loadRoute(routeMocks({
    decision: 'pending',
    sql: async (strings, ...values) => {
      const query = strings.join(' ');
      queries.push({ query, values });
      if (query.includes('SELECT id FROM dmo_live_broadcasts')) return [{ id: broadcastId }];
      if (query.includes('SELECT COUNT(*)')) return [{ count: 0 }];
      if (query.includes('INSERT INTO dmo_live_broadcast_comments')) {
        return [{ id: 19, created_at: new Date('2026-10-22T10:01:00Z') }];
      }
      return [];
    },
  }));
  const response = await route.POST(request('POST', { body: 'A thoughtful comment' }), { params: Promise.resolve({ id: broadcastId }) });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).pending, true);
  const insert = queries.find(({ query }) => query.includes('INSERT INTO dmo_live_broadcast_comments'));
  assert.ok(insert);
  assert.equal(insert.values[2], 'A thoughtful comment');
  assert.equal(insert.values[3], 'pending');
});

test('approved comments are returned immediately and rate-limited after eight in a minute', async () => {
  const inserted = [];
  const route = loadRoute(routeMocks({
    sql: async (strings, ...values) => {
      const query = strings.join(' ');
      if (query.includes('SELECT id FROM dmo_live_broadcasts')) return [{ id: broadcastId }];
      if (query.includes('SELECT COUNT(*)')) return [{ count: inserted.length >= 1 ? 8 : 0 }];
      if (query.includes('INSERT INTO dmo_live_broadcast_comments')) {
        inserted.push(values);
        return [{ id: 20, created_at: new Date('2026-10-22T10:02:00Z') }];
      }
      return [];
    },
  }));
  const first = await route.POST(request('POST', { body: 'Nice rally' }), { params: Promise.resolve({ id: broadcastId }) });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).comment.authorName, 'Fan');
  const limited = await route.POST(request('POST', { body: 'One more' }), { params: Promise.resolve({ id: broadcastId }) });
  assert.equal(limited.status, 429);
  assert.equal(inserted.length, 1);
});

test('cross-site posts and screened prohibited comments never get stored', async () => {
  let writes = 0;
  const badOrigin = loadRoute(routeMocks({ sql: async () => { writes += 1; return []; } }));
  assert.equal((await badOrigin.POST(request('POST', { body: 'Hi' }, 'https://attacker.test'), { params: Promise.resolve({ id: broadcastId }) })).status, 403);
  assert.equal(writes, 0);

  const blocked = loadRoute({
    ...routeMocks({
      sql: async (strings) => {
        if (strings.join(' ').includes('SELECT id FROM dmo_live_broadcasts')) return [{ id: broadcastId }];
        if (strings.join(' ').includes('SELECT COUNT(*)')) return [{ count: 0 }];
        if (strings.join(' ').includes('INSERT INTO')) writes += 1;
        return [];
      },
    }),
    '@/lib/moderation': {
      ModerationUnavailableError: class ModerationUnavailableError extends Error {},
      moderateTextAndImages: async () => ({ status: 'rejected', reason: 'sexual' }),
    },
  });
  const response = await blocked.POST(request('POST', { body: 'Prohibited comment' }), { params: Promise.resolve({ id: broadcastId }) });
  assert.equal(response.status, 422);
  assert.equal(writes, 0);
});

test('moderators can approve or remove uncertain live comments', async () => {
  for (const [action, expectedStatus] of [['approve', 'approved'], ['remove', 'removed']]) {
    const queries = [];
    const route = loadModerationRoute({
      'next/server': nextServer,
      '@vercel/blob': { del: async () => {}, get: async () => null, put: async () => null },
      '@/lib/auth': { getSession: async () => ({ id: '7' }), canModerateComments: () => true },
      '@/lib/db': {
        sql: async (strings, ...values) => {
          const query = strings.join(' ');
          queries.push({ query, values });
          return query.includes('UPDATE dmo_live_broadcast_comments') ? [{ id: 42 }] : [];
        },
      },
      '@/lib/discord': { announceTopic: async () => {} },
    });
    const response = await route.POST(request('POST', { kind: 'live_comment', id: 42, action }));
    assert.equal(response.status, 200);
    const update = queries.find(({ query }) => query.includes('UPDATE dmo_live_broadcast_comments'));
    assert.ok(update);
    assert.equal(update.values[0], expectedStatus);
  }
});

test('guests can reach the Live Streams page but only signed-in viewers receive broadcast controls or data', () => {
  const page = readFileSync(new URL('../app/livestreams/page.tsx', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../components/DmoLiveViewer.tsx', import.meta.url), 'utf8');
  const nav = readFileSync(new URL('../components/ForumHeader.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /redirect\(/);
  assert.match(page, /user && <DmoLiveHost/);
  assert.match(page, /<DmoLiveViewer canWatch={Boolean\(user\)}/);
  assert.match(viewer, /if \(!canWatch\)/);
  assert.match(viewer, /Sign in to watch live streams/);
  assert.match(nav, /href: '\/livestreams', label: 'Live Streams'/);
  assert.match(nav, /const navItems = NAV/);
});

test('the comments migration cascades with the broadcast and indexes pending review records', () => {
  const migration = readFileSync(new URL('../migrations/2026-10-22-live-stream-comments.sql', import.meta.url), 'utf8');
  assert.match(migration, /broadcast_id UUID NOT NULL REFERENCES dmo_live_broadcasts\(id\) ON DELETE CASCADE/);
  assert.match(migration, /moderation_status TEXT NOT NULL DEFAULT 'approved'/);
  assert.match(migration, /dmo_live_broadcast_comments_pending_idx/);
});
