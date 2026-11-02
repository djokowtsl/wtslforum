import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const signedInUser = { id: '7', username: 'Member', isAdmin: false, isModerator: false };

function loadRoute(path, options = {}) {
  const calls = { sql: [], moderation: [] };
  class ModerationUnavailableError extends Error {}
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': {
      getSession: async () => options.user === undefined ? signedInUser : options.user,
      canModerateComments: () => options.canModerate ?? true,
    },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        const query = strings.join('?');
        calls.sql.push({ query, values });
        if (options.dbError) throw new Error('database unavailable');
        return options.sqlResult ? options.sqlResult(query, values) : [];
      },
    },
    '@/lib/moderation': {
      moderateTextAndImages: async (text) => {
        calls.moderation.push(text);
        if (options.moderationError) throw new ModerationUnavailableError('Screening is unavailable.');
        return options.decision || { status: 'approved', reason: null };
      },
      ModerationUnavailableError,
    },
    '@/lib/spoilers': { spoilerMarkupError: () => options.spoilerError || null },
    '@vercel/blob': { del: async () => {}, get: async () => null, put: async () => ({ url: 'https://example.test/file' }) },
    '@/lib/discord': {
      announceTopic: async () => {},
      notifyForumAdminsForReview: async () => {},
    },
    '@/lib/forumNotifications': { notifyForumMentions: async () => {} },
  };
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (!(name in mocks)) throw new Error(`Unexpected route dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return { handlers: module.exports, calls };
}

const post = (body) => new Request('https://forum.test/api/article', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const context = (id = '12') => ({ params: Promise.resolve({ id }) });

test('article comments require a signed-in member and a published article', async () => {
  const guest = loadRoute('app/api/articles/[id]/comments/route.ts', { user: null });
  assert.equal((await guest.handlers.POST(post({ body: 'Hello' }), context())).status, 401);
  assert.equal(guest.calls.sql.length, 0);

  const missing = loadRoute('app/api/articles/[id]/comments/route.ts', {
    sqlResult: (query) => query.includes('SELECT id,slug FROM articles') ? [] : [{ id: 42 }],
  });
  assert.equal((await missing.handlers.POST(post({ body: 'Hello' }), context())).status, 404);
  assert.equal(missing.calls.moderation.length, 0);
  assert.match(missing.calls.sql[0].query, /published=TRUE/);
});

test('article comments validate, screen once, and queue uncertain text for review', async () => {
  const pending = loadRoute('app/api/articles/[id]/comments/route.ts', {
    decision: { status: 'pending', reason: 'Needs review' },
    sqlResult: (query) => query.includes('SELECT id,slug FROM articles') ? [{ id: 12, slug: 'article-twelve' }] : [{ id: 42 }],
  });
  const response = await pending.handlers.POST(post({ body: 'A thoughtful comment' }), context());
  assert.equal(response.status, 202);
  assert.equal((await response.json()).pending, true);
  assert.deepEqual(pending.calls.moderation, ['A thoughtful comment']);
  assert.equal(pending.calls.sql.length, 2);
  assert.match(pending.calls.sql[1].query, /INSERT INTO article_comments/);
  assert.equal(pending.calls.sql[1].values[4], 'pending');

  const tooLong = loadRoute('app/api/articles/[id]/comments/route.ts');
  assert.equal((await tooLong.handlers.POST(post({ body: 'x'.repeat(10001) }), context())).status, 400);
  assert.equal(tooLong.calls.sql.length, 0);

  const rejected = loadRoute('app/api/articles/[id]/comments/route.ts', {
    decision: { status: 'rejected', reason: 'Prohibited content' },
    sqlResult: () => [{ id: 12 }],
  });
  assert.equal((await rejected.handlers.POST(post({ body: 'Not allowed' }), context())).status, 422);
  assert.equal(rejected.calls.sql.length, 1);

  const unavailable = loadRoute('app/api/articles/[id]/comments/route.ts', {
    moderationError: true,
    sqlResult: () => [{ id: 12 }],
  });
  assert.equal((await unavailable.handlers.POST(post({ body: 'Try later' }), context())).status, 503);
  assert.equal(unavailable.calls.sql.length, 1);
});

test('article comment edits are owner-only, and moderators can remove published comments', async () => {
  const editor = loadRoute('app/api/article-comments/[id]/route.ts', {
    canModerate: false,
    sqlResult: (query) => query.includes('UPDATE article_comments') ? [{ id: 42 }] : [],
  });
  const edited = await editor.handlers.PATCH(post({ body: 'Edited text' }), context('42'));
  assert.equal(edited.status, 200);
  assert.equal(editor.calls.moderation.length, 1);
  assert.match(editor.calls.sql[0].query, /author_id=\?/);

  const unauthorized = loadRoute('app/api/article-comments/[id]/route.ts', {
    canModerate: false,
    sqlResult: (query) => query.includes('SELECT id FROM article_comments') ? [{ id: 42 }] : [],
  });
  assert.equal((await unauthorized.handlers.DELETE(post({}), context('42'))).status, 403);

  const moderator = loadRoute('app/api/article-comments/[id]/route.ts', {
    canModerate: true,
    sqlResult: (query) => query.includes('DELETE FROM article_comments') ? [{ id: 42 }] : [],
  });
  assert.equal((await moderator.handlers.DELETE(post({}), context('42'))).status, 200);
  assert.match(moderator.calls.sql[0].query, /OR \?/);
});

test('article reactions validate a single target and toggle against published articles only', async () => {
  const route = loadRoute('app/api/reactions/route.ts', {
    sqlResult: (query) => {
      if (query.includes('SELECT id FROM articles')) return [{ id: 12 }];
      if (query.includes('SELECT id FROM reactions')) return [];
      if (query.includes('SELECT r.emoji')) return [{ emoji: '❤️', count: 1, reacted: true, reactors: ['Member'] }];
      return [];
    },
  });
  const invalid = await route.handlers.POST(post({ articleId: 12, topicId: 3, emoji: '❤️' }));
  assert.equal(invalid.status, 400);
  assert.equal(route.calls.sql.length, 0);

  const response = await route.handlers.POST(post({ articleId: 12, emoji: '❤️' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).counts[0].reacted, true);
  assert.ok(route.calls.sql.some(({ query }) => query.includes('INSERT INTO reactions')));
  assert.match(route.calls.sql.at(-1).query, /article_id IS NOT DISTINCT FROM/);

  const unpublished = loadRoute('app/api/reactions/route.ts', { sqlResult: () => [] });
  assert.equal((await unpublished.handlers.POST(post({ articleId: 12, emoji: '🎾' }))).status, 404);
  assert.equal(unpublished.calls.sql.length, 1);
});

test('article comments use the existing moderation review actions and target-specific storage', async () => {
  for (const [action, expectedStatus] of [['approve', 'approved'], ['remove', 'removed']]) {
    const route = loadRoute('app/api/admin/moderation/review/route.ts', {
      sqlResult: (query) => query.includes('UPDATE article_comments') ? [{ id: 42 }] : [],
    });
    const response = await route.handlers.POST(post({ kind: 'article_comment', id: 42, action }));
    assert.equal(response.status, 200);
    const update = route.calls.sql.find(({ query }) => query.includes('UPDATE article_comments'));
    assert.equal(update.values[0], expectedStatus);
  }
});

test('the repeatable migration adds article comments and a unique article-reaction key', () => {
  const migration = readFileSync(new URL('../migrations/2026-10-12-article-comments-reactions.sql', import.meta.url), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS article_id/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS article_comments/);
  assert.match(migration, /reactions_article_user_emoji_idx/);
});
