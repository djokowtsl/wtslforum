import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

function loadModule(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };

test('public DMO paths must be private-store paths with a DMO filename', () => {
  const { isPublicDmoPath, isDmoReplayId } = loadModule('lib/dmoReplayLibrary.ts', {
    '@/lib/db': { sql: async () => [] },
  });

  for (const path of ['dmo/forum-match.dmo', 'dmo/discord-123-demo.DMO']) {
    assert.equal(isPublicDmoPath(path), true);
  }
  for (const path of [
    null,
    'dmo/../private.dmo',
    'dmo\\private.dmo',
    'public/match.dmo',
    'dmo/recording.mp4',
    'dmo/',
  ]) {
    assert.equal(isPublicDmoPath(path), false);
  }
  for (const id of ['1', '9223372036854775807']) assert.equal(isDmoReplayId(id), true);
  for (const id of ['', '0', '-1', '9223372036854775808', '1.5']) {
    assert.equal(isDmoReplayId(id), false);
  }
});

test('replay listing returns only safe metadata and paginates uploaded DMO files', async () => {
  const queries = [];
  const { listPublicDmoReplays } = loadModule('lib/dmoReplayLibrary.ts', {
    '@/lib/db': {
      sql: async (strings, ...values) => {
        queries.push({ text: strings.join('?'), values });
        return [
          {
            id: '41',
            tournament: 'WTSL Open',
            round_name: 'Final',
            player1: 'One',
            player2: 'Two',
            submission_date: '2026-10-30',
            source: 'discord',
          },
          { id: '40', tournament: 'WTSL Open', round_name: 'Semi', player1: 'Three', player2: 'Four', submission_date: '2026-10-29', source: 'forum' },
          { id: '39', tournament: 'WTSL Open', round_name: 'Quarter', player1: 'Five', player2: 'Six', submission_date: '2026-10-28', source: 'forum' },
        ];
      },
    },
  });

  const page = await listPublicDmoReplays({ cursor: '42', query: 'Open', limit: 2 });
  assert.deepEqual(page, {
    matches: [
      {
        id: '41',
        tournament: 'WTSL Open',
        roundName: 'Final',
        player1: 'One',
        player2: 'Two',
        submissionDate: '2026-10-30',
        source: 'discord',
      },
      {
        id: '40',
        tournament: 'WTSL Open',
        roundName: 'Semi',
        player1: 'Three',
        player2: 'Four',
        submissionDate: '2026-10-29',
        source: 'forum',
      },
    ],
    nextCursor: '40',
  });
  assert.match(queries[0].text, /private_blob_pathname LIKE 'dmo\/%'/);
  assert.match(queries[0].text, /file_name, private_blob_pathname/);
  assert.match(queries[0].text, /ORDER BY id DESC/);
  assert.ok(queries[0].values.includes('%Open%'));
  assert.ok(!JSON.stringify(page).includes('private_blob_pathname'));
});

test('replay metadata endpoint does not expose the private upload path', async () => {
  const route = loadModule('app/api/dmo-replays/[id]/route.ts', {
    'next/server': nextServer,
    '@/lib/dmoReplayLibrary': {
      getPublicDmoReplay: async () => ({
        id: '21',
        tournament: 'WTSL Open',
        roundName: 'Final',
        player1: 'One',
        player2: 'Two',
        submissionDate: '2026-10-30',
        source: 'discord',
        fileName: 'secret-file.dmo',
        privateBlobPathname: 'dmo/discord-123-secret-file.dmo',
      }),
      isDmoReplayId: (value) => /^\d{1,19}$/.test(value) && value !== '0',
      publicDmoReplayMetadata: (replay) => ({
        id: replay.id,
        tournament: replay.tournament,
        roundName: replay.roundName,
        player1: replay.player1,
        player2: replay.player2,
        submissionDate: replay.submissionDate,
        source: replay.source,
      }),
    },
  });

  const response = await route.GET(new Request('https://forum.test/api/dmo-replays/21'), {
    params: Promise.resolve({ id: '21' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, '21');
  assert.equal('privateBlobPathname' in body, false);
  assert.equal('fileName' in body, false);
});

test('public replay API serves only viewer data and caches it in the private store', async () => {
  const originalStoreId = process.env.MODERATION_BLOB_STORE_ID;
  process.env.MODERATION_BLOB_STORE_ID = 'private-store-test';
  const viewer = {
    names: ['One', 'Two'],
    score: '6-4, 7-5',
    tournament: 'WTSL Open',
    surface: 'hard',
    highlights: [],
    sets: [[6, 4], [7, 5]],
    final: { ss: [[6, 4], [7, 5]], wp: 1 },
    match: { d: 'safe viewer data', n: 2, fps: 60 },
    pts: [],
  };
  const blobReads = [];
  const blobWrites = [];
  let analyzed = 0;
  try {
    const route = loadModule('app/api/dmo-replays/[id]/replay/route.ts', {
      'node:crypto': require('node:crypto'),
      '@vercel/blob': {
        get: async (pathname, options) => {
          blobReads.push({ pathname, options });
          if (pathname.startsWith('dmo-submission-replays/')) return null;
          return {
            statusCode: 200,
            blob: { size: 12 },
            stream: new Response(Buffer.from('private dmo bytes')).body,
          };
        },
        put: async (pathname, body, options) => {
          blobWrites.push({ pathname, body, options });
          return { pathname };
        },
      },
      'next/server': nextServer,
      '@/lib/te4DmoAnalysis': {
        analyzeDmoBuffer: () => {
          analyzed += 1;
          return { viewer };
        },
      },
      '@/lib/te4DmoParser': {
        MAX_DMO_BYTES: 64 * 1024 * 1024,
        Te4DmoAnalysisError: class Te4DmoAnalysisError extends Error {},
      },
      '@/lib/dmoReplayLibrary': {
        isDmoReplayId: (value) => /^\d{1,19}$/.test(value) && value !== '0',
        getPublicDmoReplay: async () => ({
          id: '21',
          tournament: 'WTSL Open',
          roundName: 'Final',
          player1: 'One',
          player2: 'Two',
          submissionDate: '2026-10-30',
          source: 'discord',
          fileName: 'match.dmo',
          privateBlobPathname: 'dmo/discord-123-match.dmo',
        }),
        publicDmoReplayMetadata: (replay) => ({
          id: replay.id,
          tournament: replay.tournament,
          roundName: replay.roundName,
          player1: replay.player1,
          player2: replay.player2,
          submissionDate: replay.submissionDate,
          source: replay.source,
        }),
      },
    });

    const response = await route.GET(new Request('https://forum.test/api/dmo-replays/21/replay'), {
      params: Promise.resolve({ id: '21' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.viewer, viewer);
    assert.equal(body.match.id, '21');
    assert.equal('privateBlobPathname' in body.match, false);
    assert.equal(analyzed, 1);
    assert.equal(blobReads[0].options.access, 'private');
    assert.equal(blobReads[0].options.storeId, 'private-store-test');
    assert.equal(blobReads[1].pathname, 'dmo/discord-123-match.dmo');
    assert.equal(blobWrites.length, 1);
    assert.equal(blobWrites[0].options.access, 'private');
    assert.deepEqual(JSON.parse(blobWrites[0].body), { viewer });
  } finally {
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});

test('replay API does not read storage when a submission is not publicly eligible', async () => {
  const originalStoreId = process.env.MODERATION_BLOB_STORE_ID;
  process.env.MODERATION_BLOB_STORE_ID = 'private-store-test';
  let blobReads = 0;
  try {
    const route = loadModule('app/api/dmo-replays/[id]/replay/route.ts', {
      'node:crypto': require('node:crypto'),
      '@vercel/blob': { get: async () => { blobReads += 1; return null; } },
      'next/server': nextServer,
      '@/lib/te4DmoAnalysis': { analyzeDmoBuffer: () => { throw new Error('should not analyze'); } },
      '@/lib/te4DmoParser': {
        MAX_DMO_BYTES: 64 * 1024 * 1024,
        Te4DmoAnalysisError: class Te4DmoAnalysisError extends Error {},
      },
      '@/lib/dmoReplayLibrary': {
        isDmoReplayId: (value) => /^\d{1,19}$/.test(value) && value !== '0',
        getPublicDmoReplay: async () => null,
        publicDmoReplayMetadata: () => null,
      },
    });
    const response = await route.GET(new Request('https://forum.test/api/dmo-replays/21/replay'), {
      params: Promise.resolve({ id: '21' }),
    });
    assert.equal(response.status, 404);
    assert.equal(blobReads, 0);
  } finally {
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});
