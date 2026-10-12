import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as content from '../lib/articleContent.ts';
import * as uploads from '../lib/articleUploads.ts';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const admin = { id: '7', username: 'Editor', isAdmin: true };

/** Execute the real route exports against isolated auth, SQL and storage doubles. */
function route(path, options = {}) {
  const calls = { sql: [], announcements: [], uploads: [] };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { getSession: async () => options.user === undefined ? admin : options.user },
    '@/lib/db': { sql: async (strings, ...values) => {
      calls.sql.push({ query: strings.join('?'), values });
      if (options.dbError) throw new Error('database unavailable');
      return options.rows ?? [{ id: 15, slug: 'article-slug', was_published: false }];
    } },
    '@/lib/discord': { announceArticle: async (...args) => calls.announcements.push(args) },
    '@/lib/articleContent': content,
    '@/lib/articleUploads': uploads,
    '@vercel/blob': { put: async (...args) => {
      calls.uploads.push(args);
      if (options.uploadError) throw new Error('storage unavailable');
      return { url: 'https://test.public.blob.vercel-storage.com/article.png' };
    } },
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
const jsonRequest = (body, method = 'POST') => new Request('https://forum.test/api/articles', {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const context = (id = '15') => ({ params: Promise.resolve({ id }) });

test('guest and non-admin roles cannot list, create, read, edit, delete or upload articles', async () => {
  for (const user of [null, { isAdmin: false, isModerator: true }]) {
    const collection = route('app/api/articles/route.ts', { user });
    const item = route('app/api/articles/[id]/route.ts', { user });
    const images = route('app/api/articles/images/route.ts', { user });
    const responses = [
      await collection.handlers.GET(),
      await collection.handlers.POST(jsonRequest({})),
      await item.handlers.GET(jsonRequest({}), context()),
      await item.handlers.PUT(jsonRequest({}, 'PUT'), context()),
      await item.handlers.DELETE(jsonRequest({}, 'DELETE'), context()),
      await images.handlers.POST(jsonRequest({})),
    ];
    assert.deepEqual(responses.map(r => r.status), [403, 403, 403, 403, 403, 403]);
    assert.equal(collection.calls.sql.length + item.calls.sql.length, 0);
    assert.equal(images.calls.uploads.length, 0);
  }
});

test('new unfinished drafts persist as unpublished and are not announced', async () => {
  const { handlers, calls } = route('app/api/articles/route.ts');
  const response = await handlers.POST(jsonRequest({}));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 15, slug: 'article-slug', published: false });
  assert.equal(calls.sql[0].values.at(-1), false);
  assert.equal(calls.sql[0].values[1], 'Untitled article');
  assert.equal(calls.announcements.length, 0);
});

test('publication stores rich content and announces the usable slug URL', async () => {
  const { handlers, calls } = route('app/api/articles/route.ts');
  const response = await handlers.POST(jsonRequest({ title: 'The final', body: '**Great match**', published: true }));
  assert.equal(response.status, 201);
  assert.equal(content.readArticleContent(calls.sql[0].values[4]).format, 'wtsl-article-v1');
  assert.deepEqual(calls.announcements[0], ['The final', 'article-slug', 'Editor']);
});

test('draft lists and individual records are staff-only and never cached publicly', async () => {
  for (const path of ['app/api/articles/route.ts', 'app/api/articles/[id]/route.ts']) {
    const { handlers } = route(path, { rows: [{ id: 15, published: false }] });
    const response = await handlers.GET(undefined, context());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});

test('editing updates the existing record, retains its slug, and only announces publication transitions', async () => {
  for (const [published, was_published, expectedAnnouncements] of [[true, false, 1], [true, true, 0], [false, true, 0]]) {
    const { handlers, calls } = route('app/api/articles/[id]/route.ts', { rows: [{ id: 15, slug: 'original-slug', was_published }] });
    const response = await handlers.PUT(jsonRequest({ title: 'Updated title', body: 'Body', published }, 'PUT'), context());
    assert.equal(response.status, 200);
    assert.equal((await response.json()).slug, 'original-slug');
    assert.match(calls.sql[0].query, /FOR UPDATE/);
    assert.match(calls.sql[0].query, /UPDATE articles/);
    assert.equal(calls.announcements.length, expectedAnnouncements);
  }
});

test('deletion, nonexistent records and malformed IDs have explicit outcomes', async () => {
  const present = route('app/api/articles/[id]/route.ts');
  assert.deepEqual(await (await present.handlers.DELETE(undefined, context())).json(), { deleted: true });
  assert.match(present.calls.sql[0].query, /DELETE FROM articles/);
  const missing = route('app/api/articles/[id]/route.ts', { rows: [] });
  assert.equal((await missing.handlers.GET(undefined, context())).status, 404);
  assert.equal((await missing.handlers.DELETE(undefined, context())).status, 404);
  assert.equal((await missing.handlers.PUT(jsonRequest({}), context())).status, 404);
  assert.equal((await present.handlers.DELETE(undefined, context('bad'))).status, 400);
});

test('bad publication content is rejected, and database failures do not report success', async () => {
  const { handlers } = route('app/api/articles/route.ts');
  assert.equal((await handlers.POST(jsonRequest({ published: true }))).status, 400);
  const failed = route('app/api/articles/route.ts', { dbError: true });
  assert.equal((await failed.handlers.POST(jsonRequest({ title: 'Draft' }))).status, 503);
  assert.equal((await failed.handlers.GET()).status, 503);
});

test('image uploads validate contents, size and configuration and return the stored public URL', async () => {
  const previous = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const { handlers, calls } = route('app/api/articles/images/route.ts');
    assert.equal((await handlers.POST(jsonRequest({}))).status, 503);
    process.env.BLOB_READ_WRITE_TOKEN = 'isolated-test-placeholder';
    function request(bytes, name = 'image.png') {
      const form = new FormData();
      form.set('file', new File([bytes], name, { type: 'image/png' }));
      return new Request('https://forum.test/api/articles/images', { method: 'POST', body: form });
    }
    assert.equal((await handlers.POST(request('<svg onload="bad"/>'))).status, 415);
    assert.equal((await handlers.POST(request(new Uint8Array(uploads.MAX_ARTICLE_IMAGE_BYTES + 1)))).status, 413);
    const response = await handlers.POST(request(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])));
    assert.equal(response.status, 201);
    assert.match((await response.json()).url, /^https:\/\/test\.public\.blob/);
    assert.equal(calls.uploads.length, 1);
    assert.equal(calls.uploads[0][2].contentType, 'image/png');
  } finally {
    if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previous;
  }
});

test('public article queries continue to exclude drafts', () => {
  const detail = readFileSync(new URL('../app/articles/[slug]/page.tsx', import.meta.url), 'utf8');
  const queries = readFileSync(new URL('../lib/queries.ts', import.meta.url), 'utf8');
  assert.match(detail, /a\.published=true/);
  assert.match(queries, /a\.published=true/);
});
