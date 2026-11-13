import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const key = 'builder-test-key-with-at-least-24-characters';

function harness() {
  const calls = [];
  const replay = { id: '57', privateBlobPathname: 'private/replay', fileName: 'match.dmo' };
  const clip = 'a'.repeat(32);
  const track = { complete: false, cues: [{ clip }] };
  const source = readFileSync(new URL('../app/api/dmo-commentary/builder/route.ts', import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  const mocks = {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/dmoReplayLibrary': {
      isDmoReplayId: (id) => /^\d+$/.test(id),
      listDmoReplaySubmissions: async () => ({ matches: [replay], nextCursor: null }),
    },
    '@/lib/dmoReplayViewerData': {
      findViewableDmoReplay: async () => replay,
      loadDmoReplayViewer: async () => ({}),
    },
    '@/lib/dmoCommentaryTrack': {
      getDmoCommentaryTrack: async () => track,
      listMissingDmoCommentaryClips: async () => ({ missing: [], total: 1 }),
      markDmoCommentaryTrackComplete: async (...args) => calls.push(['complete', ...args]),
      storeDmoCommentaryClip: async (...args) => calls.push(['store', ...args]),
    },
  };
  new Function('require', 'module', 'exports', code)(
    (name) => mocks[name] ?? require(name), module, module.exports,
  );
  const request = (query = '', options = {}) => new Request(`https://forum.test/api/dmo-commentary/builder${query}`, {
    headers: { authorization: `Bearer ${key}` }, ...options,
  });
  return { ...module.exports, request, calls, clip };
}

test('builder authorization fails closed before touching replay storage', async () => {
  const original = process.env.DMO_COMMENTARY_UPLOAD_KEY;
  try {
    const h = harness();
    for (const configured of ['', 'short', key]) {
      process.env.DMO_COMMENTARY_UPLOAD_KEY = configured;
      const response = await h.GET(h.request('', { headers: { authorization: 'Bearer wrong' } }));
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.deepEqual(h.calls, []);
  } finally {
    if (original === undefined) delete process.env.DMO_COMMENTARY_UPLOAD_KEY;
    else process.env.DMO_COMMENTARY_UPLOAD_KEY = original;
  }
});

test('builder lists replays, completes ready tracks, and validates uploads without the bot', async () => {
  const originalKey = process.env.DMO_COMMENTARY_UPLOAD_KEY;
  const originalStore = process.env.MODERATION_BLOB_STORE_ID;
  process.env.DMO_COMMENTARY_UPLOAD_KEY = key;
  process.env.MODERATION_BLOB_STORE_ID = 'test-store';
  try {
    const h = harness();
    assert.equal((await h.GET(h.request())).status, 200);
    assert.equal((await h.GET(h.request('?replay=invalid'))).status, 404);
    const ready = await h.GET(h.request('?replay=57'));
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).missing.length, 0);
    assert.equal(h.calls[0][0], 'complete');
    const put = (query, body, headers) => h.PUT(h.request(query, {
      method: 'PUT', body,
      headers: { authorization: `Bearer ${key}`, ...headers },
    }));
    assert.equal((await put('?replay=57&clip=bad', 'bad')).status, 404);
    assert.equal((await put(`?replay=57&clip=${'b'.repeat(32)}`, 'ID3x')).status, 404);
    assert.equal((await put(`?replay=57&clip=${h.clip}`, 'text')).status, 415);
    assert.equal((await put(`?replay=57&clip=${h.clip}`, 'ID3x',
      { 'content-length': String(512 * 1024 + 1) })).status, 413);
    assert.equal((await put(`?replay=57&clip=${h.clip}`, new Uint8Array([255, 251, 0, 0]))).status, 200);
    assert.equal(h.calls.filter(([kind]) => kind === 'store').length, 1);
    delete process.env.MODERATION_BLOB_STORE_ID;
    assert.equal((await h.GET(h.request())).status, 503);
  } finally {
    if (originalKey === undefined) delete process.env.DMO_COMMENTARY_UPLOAD_KEY;
    else process.env.DMO_COMMENTARY_UPLOAD_KEY = originalKey;
    if (originalStore === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStore;
  }
});
