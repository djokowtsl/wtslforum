import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };

function loadRoute(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected route dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const jsonRequest = (body) => new Request('https://forum.test/api/community-roles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const labels = {
  tour_player: 'Tour Player',
  coach: 'Coach',
  doubles_player: 'Doubles Player',
};

test('role requests require a signed-in user and an eligible verified role', async () => {
  let requests = 0;
  const handler = loadRoute('app/api/profile/community-roles/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => null },
    '@/lib/discord': { notifyForumAdminsForReview: async () => {} },
    '@/lib/forumRoles': {
      FORUM_ROLE_LABELS: labels,
      isManualForumRoleKey: (value) => value in labels,
      requestForumRole: async () => { requests += 1; },
    },
  });
  const guest = await handler.POST(jsonRequest({ roleKey: 'coach' }));
  assert.equal(guest.status, 401);
  assert.equal(requests, 0);

  const signedInHandler = loadRoute('app/api/profile/community-roles/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ id: '42' }) },
    '@/lib/discord': { notifyForumAdminsForReview: async () => {} },
    '@/lib/forumRoles': {
      FORUM_ROLE_LABELS: labels,
      isManualForumRoleKey: (value) => value in labels,
      requestForumRole: async () => { requests += 1; },
    },
  });
  const invalidRole = await signedInHandler.POST(jsonRequest({ roleKey: 'admin' }));
  assert.equal(invalidRole.status, 400);
  assert.equal(requests, 0);
});

test('a valid role request is queued and DMs admins with the review link', async () => {
  const requestCalls = [];
  const notifications = [];
  const handler = loadRoute('app/api/profile/community-roles/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ id: '42' }) },
    '@/lib/discord': {
      notifyForumAdminsForReview: async (...args) => notifications.push(args),
    },
    '@/lib/forumRoles': {
      FORUM_ROLE_LABELS: labels,
      isManualForumRoleKey: (value) => value in labels,
      requestForumRole: async (...args) => requestCalls.push(args),
    },
  });

  const response = await handler.POST(jsonRequest({ roleKey: 'coach' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(requestCalls, [['42', 'coach']]);
  assert.deepEqual(notifications, [['A Coach role request needs review.', '/admin/roles']]);
});

test('only admins can review requests and approved decisions notify the member', async () => {
  const reviewCalls = [];
  const memberNotifications = [];
  const dependencies = {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ id: '99', isAdmin: true }) },
    '@/lib/discord': {
      notifyForumRoleDecision: async (...args) => memberNotifications.push(args),
    },
    '@/lib/forumRoles': {
      FORUM_ROLE_LABELS: labels,
      reviewForumRoleRequest: async (...args) => {
        reviewCalls.push(args);
        return { discordId: '88', roleKey: 'doubles_player', decision: 'approved' };
      },
    },
  };
  const adminHandler = loadRoute('app/api/admin/roles/requests/route.ts', dependencies);
  const response = await adminHandler.POST(jsonRequest({ requestId: 17, decision: 'approved' }));
  assert.equal(response.status, 200);
  assert.deepEqual(reviewCalls, [[17, '99', 'approved']]);
  assert.deepEqual(memberNotifications, [['88', 'Doubles Player', 'approved']]);

  let unauthorizedReviews = 0;
  const nonAdminHandler = loadRoute('app/api/admin/roles/requests/route.ts', {
    ...dependencies,
    '@/lib/auth': { getSession: async () => ({ id: '12', isAdmin: false }) },
    '@/lib/forumRoles': {
      ...dependencies['@/lib/forumRoles'],
      reviewForumRoleRequest: async () => { unauthorizedReviews += 1; return null; },
    },
  });
  const denied = await nonAdminHandler.POST(jsonRequest({ requestId: 17, decision: 'approved' }));
  assert.equal(denied.status, 403);
  assert.equal(unauthorizedReviews, 0);
});

test('Yapper badges use the configured 25-approved-post threshold', async () => {
  let queryText = '';
  const roles = loadRoute('lib/forumRoles.ts', {
    '@/lib/db': {
      sql: async (strings) => {
        queryText = strings.join('?');
        return [
          { user_id: '42', approved_role_keys: 'coach', approved_post_count: 24, has_article: false },
          { user_id: '43', approved_role_keys: 'tour_player', approved_post_count: 25, has_article: true },
        ];
      },
    },
  });

  const badges = await roles.getForumRoleBadgeMap(['42', '43']);
  assert.deepEqual(
    badges.get('42').map((badge) => badge.label),
    ['Coach'],
  );
  assert.deepEqual(
    badges.get('43').map((badge) => badge.label),
    ['Tour Player', 'Yapper', 'Writer'],
  );
  assert.match(queryText, /moderation_status = 'approved'/);
  assert.match(queryText, /FROM topics/);
  assert.match(queryText, /FROM replies/);
  assert.equal(roles.YAPPER_POST_THRESHOLD, 25);
});

test('Writer sync reuses the existing server role and creates it when missing', async () => {
  const discord = loadRoute('lib/discord.ts', {});
  process.env.DISCORD_BOT_TOKEN = 'unit-test-token';
  const originalFetch = globalThis.fetch;

  try {
    const reusedCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      reusedCalls.push({ url: String(url), init });
      if (String(url).endsWith('/members/88')) return new Response('{}');
      if (String(url).endsWith('/roles')) return Response.json([{ id: 'writer-role', name: 'Writer' }]);
      if (String(url).endsWith('/roles/writer-role')) return new Response(null, { status: 204 });
      throw new Error(`Unexpected Discord request: ${url}`);
    };
    await discord.ensureDiscordWriterRole('88');
    assert.equal(reusedCalls.filter(({ init }) => init.method === 'POST').length, 0);
    assert.equal(reusedCalls.at(-1).init.method, 'PUT');

    const createdCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      createdCalls.push({ url: String(url), init });
      if (String(url).endsWith('/members/99')) return new Response('{}');
      if (String(url).endsWith('/roles') && init.method === 'POST') {
        return Response.json({ id: 'new-writer-role', name: 'Writer' });
      }
      if (String(url).endsWith('/roles')) return Response.json([]);
      if (String(url).endsWith('/roles/new-writer-role')) return new Response(null, { status: 204 });
      throw new Error(`Unexpected Discord request: ${url}`);
    };
    await discord.ensureDiscordWriterRole('99');
    assert.equal(createdCalls.filter(({ init }) => init.method === 'POST').length, 1);
    assert.match(createdCalls.at(-1).url, /\/members\/99\/roles\/new-writer-role$/);
    assert.equal(createdCalls.at(-1).init.method, 'PUT');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.DISCORD_BOT_TOKEN;
  }
});
