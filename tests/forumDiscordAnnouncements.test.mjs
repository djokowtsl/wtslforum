import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

function loadModule(path, mocks = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    if (name === '@/lib/forumNotifications') return { notifyForumMentions: async () => {} };
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };

test('published articles and admin threads use their configured Discord destinations', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  const sent = [];
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://forum.test/';
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init });
    return new Response('{}', { status: 200 });
  };
  try {
    const { announceAdminTopic, announceArticle } = loadModule('lib/discord.ts');
    await announceArticle('The final', 'the-final', 'Editor');
    await announceAdminTopic('New discussion', 42, 'Editor');

    assert.match(sent[0].url, /\/channels\/1556169407011491901\/messages$/);
    assert.match(JSON.parse(sent[0].init.body).content, /https:\/\/forum\.test\/articles\/the-final/);
    assert.match(sent[1].url, /\/channels\/801907383055810638\/messages$/);
    assert.match(JSON.parse(sent[1].init.body).content, /https:\/\/forum\.test\/discussions\/42/);
    for (const request of sent) {
      assert.deepEqual(JSON.parse(request.init.body).allowed_mentions, { parse: [] });
      assert.equal(request.init.signal.aborted, false);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
    if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
});

function topicRoute(user, moderationStatus = 'approved') {
  const announcements = [];
  const mentions = [];
  const handlers = loadModule('app/api/topics/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => user },
    '@/lib/db': { sql: async () => [{ id: 42 }] },
    '@/lib/discord': {
      announceTopic: async (...args) => announcements.push(['community', ...args]),
      announceAdminTopic: async (...args) => announcements.push(['admin', ...args]),
    },
    '@/lib/matchThreads': { claimMatchThread: async (_key, id) => id },
    '@/lib/moderation': {
      looksLikeImageUrl: () => false,
      moderateTextAndImages: async () => ({ status: moderationStatus, reason: null }),
      ModerationUnavailableError: class ModerationUnavailableError extends Error {},
    },
    '@/lib/spoilers': { spoilerMarkupError: () => null },
    '@/lib/wtsl': { isTourCode: () => false },
    '@/lib/media': { ensureTopicVideoSchema: async () => {} },
    '@/lib/forumNotifications': { notifyForumMentions: async (input) => mentions.push(input) },
  });
  return { handlers, announcements, mentions };
}

const topicRequest = () => new Request('https://forum.test/api/topics', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'New discussion', body: 'Discussion text for @Player', categoryId: 1 }),
});

test('new admin threads use the dedicated channel while member threads keep their existing route', async () => {
  for (const [user, expected] of [
    [{ id: '7', username: 'Editor', isAdmin: true }, 'admin'],
    [{ id: '8', username: 'Member', isAdmin: false }, 'community'],
  ]) {
    const { handlers, announcements, mentions } = topicRoute(user);
    const response = await handlers.POST(topicRequest());
    assert.equal(response.status, 201);
    assert.deepEqual(announcements, [[expected, 'New discussion', 42, user.username]]);
    assert.deepEqual(mentions, [{
      body: 'Discussion text for @Player',
      authorUserId: user.id,
      authorName: user.username,
      context: 'in a discussion',
      href: '/discussions/42',
    }]);
  }
});

test('pending admin threads wait until approval before being announced', async () => {
  const { handlers, announcements, mentions } = topicRoute(
    { id: '7', username: 'Editor', isAdmin: true },
    'pending',
  );
  const response = await handlers.POST(topicRequest());
  assert.equal(response.status, 202);
  assert.deepEqual(announcements, []);
  assert.deepEqual(mentions, []);
});

function moderationReview(author) {
  const announcements = [];
  const mentions = [];
  let query = 0;
  const handlers = loadModule('app/api/admin/moderation/review/route.ts', {
    'next/server': nextServer,
    '@vercel/blob': { del: async () => {}, get: async () => null, put: async () => null },
    '@/lib/auth': { canModerateComments: () => true, getSession: async () => ({ id: '9', isAdmin: true }) },
    '@/lib/db': {
      sql: async () => {
        query += 1;
        return query === 1
          ? [{ id: 42, title: 'New discussion', body: 'Discussion text for @Player', author_id: 7 }]
          : [author];
      },
    },
    '@/lib/discord': {
      announceTopic: async (...args) => announcements.push(['community', ...args]),
      announceAdminTopic: async (...args) => announcements.push(['admin', ...args]),
    },
    '@/lib/forumNotifications': { notifyForumMentions: async (input) => mentions.push(input) },
  });
  return { handlers, announcements, mentions };
}

test('moderation approval routes admin-authored threads to the admin channel', async () => {
  const originalAdminIds = process.env.ADMIN_DISCORD_IDS;
  process.env.ADMIN_DISCORD_IDS = '';
  try {
    for (const [author, expected] of [
      [{ display_name: 'Editor', discord_id: '111', is_admin: true }, 'admin'],
      [{ display_name: 'Member', discord_id: '222', is_admin: false }, 'community'],
    ]) {
      const { handlers, announcements, mentions } = moderationReview(author);
      const response = await handlers.POST(new Request('https://forum.test/api/admin/moderation/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'topic', id: 42, action: 'approve' }),
      }));
      assert.equal(response.status, 200);
      assert.deepEqual(announcements, [[expected, 'New discussion', 42, author.display_name]]);
      assert.deepEqual(mentions, [{
        body: 'Discussion text for @Player',
        authorUserId: 7,
        authorName: author.display_name,
        context: 'in a discussion',
        href: '/discussions/42',
      }]);
    }
  } finally {
    if (originalAdminIds === undefined) delete process.env.ADMIN_DISCORD_IDS;
    else process.env.ADMIN_DISCORD_IDS = originalAdminIds;
  }
});
