import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const admin = { id: '7', username: 'Admin', isAdmin: true };
const originalStoreId = process.env.MODERATION_BLOB_STORE_ID;

function loadRoute(path, mocks) {
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
  return module.exports;
}

function request(body) {
  return new Request('https://forum.test/api/admin/dmo-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('DMO upload token generation rejects guests and non-admin members', async () => {
  for (const user of [null, { id: '8', isAdmin: false }]) {
    let signed = false;
    const handlers = loadRoute('app/api/admin/dmo-analysis/upload/route.ts', {
      '@vercel/blob': { issueSignedToken: async () => { signed = true; } },
      '@vercel/blob/client': { handleUploadPresigned: async () => { signed = true; } },
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { getSession: async () => user },
      '@/lib/te4DmoParser': { MAX_DMO_BYTES: 64 * 1024 * 1024 },
    });
    const response = await handlers.POST(request({ type: 'blob.generate-presigned-url' }));
    assert.equal(response.status, 403);
    assert.equal(signed, false);
  }
});

test('DMO upload token is scoped to the private store, DMO path and size limit', async () => {
  process.env.MODERATION_BLOB_STORE_ID = 'store_private_test';
  try {
    const calls = [];
    const handlers = loadRoute('app/api/admin/dmo-analysis/upload/route.ts', {
      '@vercel/blob': {
        issueSignedToken: async (options) => {
          calls.push(options);
          return { delegationToken: 'delegation', clientSigningToken: 'signature', validUntil: options.validUntil };
        },
      },
      '@vercel/blob/client': {
        handleUploadPresigned: async (options) => {
          const signed = await options.getSignedToken('dmo-analysis/test-match.dmo', null, true);
          return { type: 'blob.generate-presigned-url', signed };
        },
      },
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { getSession: async () => admin },
      '@/lib/te4DmoParser': { MAX_DMO_BYTES: 64 * 1024 * 1024 },
    });
    const response = await handlers.POST(request({ type: 'blob.generate-presigned-url' }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pathname, 'dmo-analysis/test-match.dmo');
    assert.equal(calls[0].storeId, 'store_private_test');
    assert.deepEqual(calls[0].operations, ['put']);
    assert.equal(calls[0].maximumSizeInBytes, 64 * 1024 * 1024);
    assert.deepEqual(calls[0].allowedContentTypes, ['application/octet-stream']);
    const payload = await response.json();
    assert.equal(payload.signed.urlOptions.maximumSizeInBytes, 64 * 1024 * 1024);
  } finally {
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});

test('DMO upload token rejects path traversal and non-demo uploads', async () => {
  process.env.MODERATION_BLOB_STORE_ID = 'store_private_test';
  try {
    const handlers = loadRoute('app/api/admin/dmo-analysis/upload/route.ts', {
      '@vercel/blob': { issueSignedToken: async () => { throw new Error('should not issue'); } },
      '@vercel/blob/client': {
        handleUploadPresigned: async (options) => options.getSignedToken('../public/file.png', null, false),
      },
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { getSession: async () => admin },
      '@/lib/te4DmoParser': { MAX_DMO_BYTES: 64 * 1024 * 1024 },
    });
    const response = await handlers.POST(request({ type: 'blob.generate-presigned-url' }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /only DMO/i);
  } finally {
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});

test('analysis API is admin-only and does not fetch private files for guests', async () => {
  let fetched = false;
  const handlers = loadRoute('app/api/admin/dmo-analysis/analyze/route.ts', {
    '@vercel/blob': { get: async () => { fetched = true; }, del: async () => {} },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { getSession: async () => null },
    '@/lib/te4DmoAnalysis': { analyzeDmoBuffer: () => ({}) },
    '@/lib/te4DmoParser': { MAX_DMO_BYTES: 64 * 1024 * 1024, Te4DmoAnalysisError: class extends Error {} },
  });
  const response = await handlers.POST(request({ pathname: 'dmo-analysis/test.dmo', filename: 'test.dmo' }));
  assert.equal(response.status, 403);
  assert.equal(fetched, false);
});

test('analysis API reads only private uploads and deletes them after use', async () => {
  process.env.MODERATION_BLOB_STORE_ID = 'store_private_test';
  try {
    const calls = { get: [], del: [], analyzed: [] };
    const handlers = loadRoute('app/api/admin/dmo-analysis/analyze/route.ts', {
      '@vercel/blob': {
        get: async (...args) => {
          calls.get.push(args);
          return {
            statusCode: 200,
            stream: new Response(Buffer.from('test demo')).body,
            blob: { size: 9 },
          };
        },
        del: async (...args) => calls.del.push(args),
      },
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { getSession: async () => admin },
      '@/lib/te4DmoAnalysis': {
        analyzeDmoBuffer: (bytes, filename) => {
          calls.analyzed.push([bytes.toString(), filename]);
          return { filename, pointsAnalyzed: 1 };
        },
      },
      '@/lib/te4DmoParser': { MAX_DMO_BYTES: 64 * 1024 * 1024, Te4DmoAnalysisError: class extends Error {} },
    });
    const response = await handlers.POST(request({
      pathname: 'dmo-analysis/test-match.dmo',
      filename: 'test-match.dmo',
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await response.json(), { filename: 'test-match.dmo', pointsAnalyzed: 1 });
    assert.deepEqual(calls.get, [['dmo-analysis/test-match.dmo', {
      access: 'private',
      storeId: 'store_private_test',
      useCache: false,
    }]]);
    assert.deepEqual(calls.analyzed, [['test demo', 'test-match.dmo']]);
    assert.deepEqual(calls.del, [['dmo-analysis/test-match.dmo', { storeId: 'store_private_test' }]]);
  } finally {
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});

test('admin DMO analysis page has its own gate and member media submission route remains present', () => {
  const page = readFileSync(new URL('../app/admin/dmo-analysis/page.tsx', import.meta.url), 'utf8');
  const mediaPage = readFileSync(new URL('../app/media/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /getSession/);
  assert.match(page, /if \(!user\.isAdmin\) redirect\('\/'\)/);
  assert.match(mediaPage, /DMO|recording|match/i);
});
