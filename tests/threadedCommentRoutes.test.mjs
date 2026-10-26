import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function load(path, mocks) {
  const source = require('node:fs').readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = require('next/dist/build/swc').transformSync(source, {
    jsc: {
      parser: { syntax: 'typescript', tsx: path.endsWith('.tsx') },
      target: 'es2022',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (name) => name in mocks ? mocks[name] : require(name),
    module,
    module.exports,
  );
  return module.exports;
}

function makeSql(handler) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const query = strings.join(' ');
    calls.push({ query, values });
    return handler(query, values);
  };
  return { sql, calls };
}

function request(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };
const signedIn = { getSession: async () => ({ id: '12', isAdmin: false }) };
const moderation = {
  moderateTextAndImages: async () => ({ status: 'approved', reason: null }),
  ModerationUnavailableError: class ModerationUnavailableError extends Error {},
};
const spoilers = { spoilerMarkupError: () => null };

test('discussion replies can target an approved comment in the same discussion', async () => {
  let insertedValues;
  const { sql } = makeSql((query, values) => {
    if (query.includes('SELECT locked FROM topics')) return [{ locked: false }];
    if (query.includes('SELECT id FROM replies')) return [{ id: 41 }];
    if (query.includes('INSERT INTO replies')) {
      insertedValues = values;
      return [{ id: 42 }];
    }
    if (query.includes('UPDATE topics SET updated_at')) return [];
    throw new Error(`Unexpected SQL in test: ${query}`);
  });
  const route = load('app/api/replies/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': signedIn,
    '@/lib/db': { sql },
    '@/lib/moderation': moderation,
    '@/lib/spoilers': spoilers,
  });

  const response = await route.POST(request('https://forum.test/api/replies', {
    topicId: 7, parentReplyId: 41, body: 'A direct reply',
  }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, 42);
  assert.deepEqual(insertedValues, [7, 41, 12, 'A direct reply', 'approved', null]);
});

test('discussion replies cannot target a comment from another discussion', async () => {
  const { sql } = makeSql((query) => {
    if (query.includes('SELECT locked FROM topics')) return [{ locked: false }];
    if (query.includes('SELECT id FROM replies')) return [];
    throw new Error(`Unexpected SQL in test: ${query}`);
  });
  const route = load('app/api/replies/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': signedIn,
    '@/lib/db': { sql },
    '@/lib/moderation': moderation,
    '@/lib/spoilers': spoilers,
  });

  const response = await route.POST(request('https://forum.test/api/replies', {
    topicId: 7, parentReplyId: 41, body: 'A reply to an unavailable comment',
  }));
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /no longer available/i);
});

test('article comments can target an approved comment on the same article', async () => {
  let insertedValues;
  const { sql } = makeSql((query, values) => {
    if (query.includes('SELECT id FROM articles')) return [{ id: 8 }];
    if (query.includes('SELECT id FROM article_comments')) return [{ id: 91 }];
    if (query.includes('INSERT INTO article_comments')) {
      insertedValues = values;
      return [{ id: 92 }];
    }
    throw new Error(`Unexpected SQL in test: ${query}`);
  });
  const route = load('app/api/articles/[id]/comments/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': signedIn,
    '@/lib/db': { sql },
    '@/lib/moderation': moderation,
    '@/lib/spoilers': spoilers,
  });

  const response = await route.POST(
    request('https://forum.test/api/articles/8/comments', { parentCommentId: 91, body: 'An article reply' }),
    { params: Promise.resolve({ id: '8' }) },
  );
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, 92);
  assert.deepEqual(insertedValues, [8, 91, 12, 'An article reply', 'approved', null]);
});

test('reactions can target an approved comment on a published article', async () => {
  const { sql, calls } = makeSql((query) => {
    if (query.includes('SELECT c.id FROM article_comments')) return [{ id: 91 }];
    if (query.includes('SELECT id FROM article_comment_reactions')) return [];
    if (query.includes('SELECT id FROM reactions')) return [];
    if (query.includes('INSERT INTO article_comment_reactions')) return [];
    if (query.includes('INSERT INTO reactions')) return [];
    if (query.includes('SELECT r.emoji')) return [{
      emoji: '👍', count: 1, reacted: true, reactors: ['Forum member'],
    }];
    throw new Error(`Unexpected SQL in test: ${query}`);
  });
  const route = load('app/api/reactions/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': signedIn,
    '@/lib/db': { sql },
  });

  const response = await route.POST(request('https://forum.test/api/reactions', {
    articleCommentId: 91, emoji: '👍',
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.counts, [{
    emoji: '👍', count: 1, reacted: true, reactors: ['Forum member'],
  }]);
  assert.ok(calls.some((call) => call.query.includes('INSERT INTO article_comment_reactions')));
  assert.ok(calls.some((call) => call.query.includes('article_comment_id')));
});

test('article-comment reactions toggle off without changing other reaction types', async () => {
  const { sql, calls } = makeSql((query) => {
    if (query.includes('SELECT c.id FROM article_comments')) return [{ id: 91 }];
    if (query.includes('SELECT id FROM article_comment_reactions')) return [{ id: 5 }];
    if (query.includes('DELETE FROM article_comment_reactions')) return [];
    if (query.includes('SELECT r.emoji')) return [];
    throw new Error(`Unexpected SQL in test: ${query}`);
  });
  const route = load('app/api/reactions/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': signedIn,
    '@/lib/db': { sql },
  });

  const response = await route.POST(request('https://forum.test/api/reactions', {
    articleCommentId: 91, emoji: '👍',
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reacted, false);
  assert.ok(calls.some((call) => call.query.includes('DELETE FROM article_comment_reactions')));
  assert.ok(!calls.some((call) => call.query.includes('DELETE FROM reactions')));
});
