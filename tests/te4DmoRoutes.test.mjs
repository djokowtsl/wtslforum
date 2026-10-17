import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const admin = { id: '7', username: 'Admin', isAdmin: true };
const originalStoreId = process.env.MODERATION_BLOB_STORE_ID;
const characterMatcher = loadRoute('lib/te4DmoCharacterMatch.ts', {});
const characterLookupMocks = {
  '@/lib/characterProfileSafety.mjs': {
    removeUnsupportedCharacterProjections: (value) => value,
  },
  '@/lib/te4DmoCharacterMatch': characterMatcher,
  '@/lib/wtsl': { fetchWTSLAllResults: async () => [] },
  '@/lib/wtsl-core': {
    wtslCore: { characterStats: async () => ({ profile: null }) },
  },
};

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

function request(body, headers = {}) {
  return new Request('https://forum.test/api/admin/dmo-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('presigned URL retrieval errors recognize the Vercel Blob prefix', () => {
  const { isPresignedUrlRetrievalFailure } = loadRoute('lib/dmoUploadErrors.ts', {});

  assert.equal(
    isPresignedUrlRetrievalFailure(new Error('Vercel Blob: Failed to retrieve the presigned URL')),
    true,
  );
  assert.equal(
    isPresignedUrlRetrievalFailure(new Error('Failed to retrieve the presigned URL')),
    true,
  );
  assert.equal(isPresignedUrlRetrievalFailure(new Error('The file is too large.')), false);
});

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

test('DMO upload token failures log a correlation id and redacted diagnostic without exposing it to the client', async () => {
  process.env.MODERATION_BLOB_STORE_ID = 'store_private_test';
  const requestId = 'a1b2c3d4-e5f6-4789-a123-456789abcdef';
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const handlers = loadRoute('app/api/admin/dmo-analysis/upload/route.ts', {
      '@vercel/blob': {
        issueSignedToken: async () => {
          throw new Error('Blob API rejected token=private-value Authorization: Bearer private-bearer');
        },
      },
      '@vercel/blob/client': {
        handleUploadPresigned: async (options) => options.getSignedToken('dmo-analysis/test-match.dmo', null, true),
      },
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { getSession: async () => admin },
      '@/lib/te4DmoParser': { MAX_DMO_BYTES: 64 * 1024 * 1024 },
    });
    const response = await handlers.POST(
      request(
        { type: 'blob.generate-presigned-url' },
        { 'x-dmo-upload-id': requestId },
      ),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: 'A secure private upload could not be prepared.',
    });
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], '[dmo-analysis] private upload token failed');
    assert.deepEqual(logged[0][1], {
      requestId,
      errorName: 'Error',
      errorMessage: 'Blob API rejected token=[redacted] Authorization: Bearer [redacted]',
    });
  } finally {
    console.error = originalConsoleError;
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});

test('analysis API is admin-only and does not fetch private files for guests', async () => {
  let fetched = false;
  const handlers = loadRoute('app/api/admin/dmo-analysis/analyze/route.ts', {
      ...characterLookupMocks,
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
      ...characterLookupMocks,
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
    const payload = await response.json();
    assert.deepEqual(payload, {
      filename: 'test-match.dmo',
      pointsAnalyzed: 1,
      characterAttribution: {
        status: 'insufficient_metadata',
        source: null,
        match: null,
        players: null,
      },
    });
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

test('DMO character matching requires one exact result and maps reversed player order', () => {
  const { resolveDmoCharacterMatch } = characterMatcher;
  const analysis = {
    names: ['Alice', 'Bea'],
    score: '6-3 6-4',
    sets: [[6, 3], [6, 4]],
    viewer: { tournament: '0115 Spring Cup' },
  };
  const row = {
    tournamentName: 'Spring Cup',
    round: 'Final',
    player1Id: '22',
    player1Name: 'Bea',
    player1Character: 'Counter',
    player2Id: '11',
    player2Name: 'Alice',
    player2Character: 'Baseliner',
    date: '2026-10-17',
    score: '3-6 4-6',
  };

  const match = resolveDmoCharacterMatch(analysis, [row]);
  assert.equal(match.status, 'matched');
  assert.deepEqual(match.players.map((player) => player.character), ['Baseliner', 'Counter']);
  assert.deepEqual(match.match, {
    tournamentName: 'Spring Cup',
    round: 'Final',
    date: '2026-10-17',
  });

  const ambiguous = resolveDmoCharacterMatch(analysis, [row, { ...row }]);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.players, null);
});

test('DMO character matching refuses score mismatches and missing match metadata', () => {
  const { resolveDmoCharacterMatch } = characterMatcher;
  const analysis = {
    names: ['Alice', 'Bea'],
    score: '6-3 6-4',
    sets: [[6, 3], [6, 4]],
    viewer: { tournament: 'Spring Cup' },
  };
  const row = {
    tournamentName: 'Spring Cup',
    round: 'Final',
    player1Id: '11',
    player1Name: 'Alice',
    player1Character: 'Counter',
    player2Id: '22',
    player2Name: 'Bea',
    player2Character: 'Baseliner',
    date: null,
    score: '6-3 6-2',
  };

  assert.equal(resolveDmoCharacterMatch(analysis, [row]).status, 'not_found');
  assert.equal(resolveDmoCharacterMatch({
    ...analysis,
    names: ['Player 1', 'Player 2'],
  }, [row]).status, 'insufficient_metadata');
});

test('character matching ignores the numeric event code embedded in DMO tournament labels', () => {
  const { resolveDmoCharacterMatch } = characterMatcher;
  const analysis = {
    names: ['Alice', 'Bea'],
    score: '6-3 6-4',
    sets: [[6, 3], [6, 4]],
    viewer: { tournament: '0115 Tokyo ATP 500' },
  };
  const row = {
    tournamentName: 'Tokyo ATP 500',
    round: 'Final',
    player1Id: '11',
    player1Name: 'Alice',
    player1Character: 'Counter',
    player2Id: '22',
    player2Name: 'Bea',
    player2Character: 'Baseliner',
    date: null,
    score: '6-3 6-4',
  };

  assert.equal(resolveDmoCharacterMatch(analysis, [row]).status, 'matched');
});

test('admin analysis attaches matched character profiles from the character-page model', async () => {
  process.env.MODERATION_BLOB_STORE_ID = 'store_private_test';
  try {
    const profileCalls = [];
    const analysis = {
      filename: 'Spring Cup.dmo',
      names: ['Alice', 'Bea'],
      score: '6-3 6-4',
      sets: [[6, 3], [6, 4]],
      pointsAnalyzed: 12,
      viewer: { tournament: 'Spring Cup' },
      warnings: [],
    };
    const rows = [{
      tournamentName: 'Spring Cup',
      round: 'Final',
      player1Id: '11',
      player1Name: 'Alice',
      player1Character: 'Counter',
      player2Id: '22',
      player2Name: 'Bea',
      player2Character: 'Baseliner',
      date: '2026-10-17',
      score: '6-3 6-4',
    }];
    const handlers = loadRoute('app/api/admin/dmo-analysis/analyze/route.ts', {
      ...characterLookupMocks,
      '@vercel/blob': {
        get: async () => ({
          statusCode: 200,
          stream: new Response(Buffer.from('test demo')).body,
          blob: { size: 9 },
        }),
        del: async () => {},
      },
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { getSession: async () => admin },
      '@/lib/te4DmoAnalysis': { analyzeDmoBuffer: () => analysis },
      '@/lib/te4DmoParser': { MAX_DMO_BYTES: 64 * 1024 * 1024, Te4DmoAnalysisError: class extends Error {} },
      '@/lib/wtsl': { fetchWTSLAllResults: async () => rows },
      '@/lib/wtsl-core': {
        wtslCore: {
          characterStats: async ({ character, ...query }) => {
            profileCalls.push({ character, ...query });
            return {
              profile: {
                character,
                style: 'Counter',
                combined_ratings: [{ attribute: 'Serve Rating', value: 77 }],
              },
            };
          },
        },
      },
    });
    const response = await handlers.POST(request({
      pathname: 'dmo-analysis/test-match.dmo',
      filename: 'Spring Cup.dmo',
    }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.characterAttribution.status, 'matched');
    assert.deepEqual(
      payload.characterAttribution.players.map((player) => player.character),
      ['Counter', 'Baseliner'],
    );
    assert.equal(payload.characterAttribution.players[0].profile.style, 'Counter');
    assert.equal(profileCalls.length, 2);
    assert.ok(profileCalls.every((call) => call.tour === 'atp' && call.includeOfficial === false));
  } finally {
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});

test('an unavailable WTSL results feed does not fail DMO analysis', async () => {
  process.env.MODERATION_BLOB_STORE_ID = 'store_private_test';
  try {
    const analysis = {
      filename: 'Spring Cup.dmo',
      names: ['Alice', 'Bea'],
      score: '6-3 6-4',
      sets: [[6, 3], [6, 4]],
      pointsAnalyzed: 12,
      viewer: { tournament: 'Spring Cup' },
    };
    const handlers = loadRoute('app/api/admin/dmo-analysis/analyze/route.ts', {
      ...characterLookupMocks,
      '@vercel/blob': {
        get: async () => ({
          statusCode: 200,
          stream: new Response(Buffer.from('test demo')).body,
          blob: { size: 9 },
        }),
        del: async () => {},
      },
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { getSession: async () => admin },
      '@/lib/te4DmoAnalysis': { analyzeDmoBuffer: () => analysis },
      '@/lib/te4DmoParser': { MAX_DMO_BYTES: 64 * 1024 * 1024, Te4DmoAnalysisError: class extends Error {} },
      '@/lib/wtsl': { fetchWTSLAllResults: async () => { throw new Error('temporary failure'); } },
    });
    const response = await handlers.POST(request({
      pathname: 'dmo-analysis/test-match.dmo',
      filename: 'Spring Cup.dmo',
    }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.pointsAnalyzed, 12);
    assert.equal(payload.characterAttribution.status, 'unavailable');
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

test('DMO submission tag edits are admin-only and validate the full tag set', async () => {
  const calls = [];
  const handlers = loadRoute('app/api/admin/dmo-submissions/[id]/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { getSession: async () => admin },
    '@/lib/dmo-submissions': {
      updateDmoSubmissionTags: async (id, tags) => {
        calls.push({ id, tags });
        return { id, ...tags };
      },
    },
  });
  const response = await handlers.PATCH(
    new Request('https://forum.test/api/admin/dmo-submissions/41', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournament: '  Autumn Cup  ',
        roundName: 'Final',
        player1: 'Player One',
        player2: 'Player Two',
        submissionDate: '2026-10-16',
      }),
    }),
    { params: Promise.resolve({ id: '41' }) },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{
    id: 41,
    tags: {
      tournament: 'Autumn Cup',
      roundName: 'Final',
      player1: 'Player One',
      player2: 'Player Two',
      submissionDate: '2026-10-16',
    },
  }]);

  const invalidDate = await handlers.PATCH(
    new Request('https://forum.test/api/admin/dmo-submissions/41', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tournament: 'Autumn Cup',
        roundName: 'Final',
        player1: 'Player One',
        player2: 'Player Two',
        submissionDate: '2026-02-30',
      }),
    }),
    { params: Promise.resolve({ id: '41' }) },
  );
  assert.equal(invalidDate.status, 400);
  assert.equal(calls.length, 1);
});

test('DMO tag edits reject non-admins without updating metadata', async () => {
  let updated = false;
  const handlers = loadRoute('app/api/admin/dmo-submissions/[id]/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { getSession: async () => ({ ...admin, isAdmin: false }) },
    '@/lib/dmo-submissions': {
      updateDmoSubmissionTags: async () => {
        updated = true;
        return {};
      },
    },
  });
  const response = await handlers.PATCH(
    new Request('https://forum.test/api/admin/dmo-submissions/41', { method: 'PATCH' }),
    { params: Promise.resolve({ id: '41' }) },
  );
  assert.equal(response.status, 403);
  assert.equal(updated, false);
});

test('Discord DMO sync preserves the original London submission date', async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DISCORD_BOT_TOKEN;
  const { submissionDateInLondon } = loadRoute('lib/dmo-submissions.ts', {
    '@/lib/db': { sql: () => [] },
  });
  process.env.DISCORD_BOT_TOKEN = 'test-token';
  process.env.MODERATION_BLOB_STORE_ID = 'store_private_test';
  let created = null;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/api/v10/channels/')) {
      return new Response(JSON.stringify({
        timestamp: '2026-10-16T22:30:00.000Z',
        attachments: [{
          filename: 'autumn-final.dmo',
          size: 3,
          url: 'https://cdn.discordapp.com/attachments/1/autumn-final.dmo',
          content_type: 'application/octet-stream',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://cdn.discordapp.com/')) {
      return new Response(Buffer.from('dmo'), { status: 200 });
    }
    throw new Error('Unexpected fetch URL');
  };

  try {
    const handlers = loadRoute('app/api/sync/dmo-submissions/route.ts', {
      '@vercel/blob': {
        put: async () => ({ pathname: 'dmo/test.dmo' }),
        del: async () => {},
      },
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/wtslSyncAuth': { isWtslSyncAuthorized: () => true },
      '@/lib/dmo-submissions': {
        createDmoSubmission: async (input) => {
          created = input;
          return { id: 88, private_blob_pathname: input.privateBlobPathname };
        },
        findDmoSubmissionByDiscordMessage: async () => null,
        submissionDateInLondon,
      },
    });
    const response = await handlers.POST(
      new Request('https://forum.test/api/sync/dmo-submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournament: 'Autumn Cup',
          round: 'Final',
          player1: 'Player One',
          player2: 'Player Two',
          submitterDiscordId: '123',
          submitterName: 'Player One',
          discordChannelId: '1055277431398866995',
          discordMessageId: '1001',
        }),
      }),
    );
    assert.equal(response.status, 201);
    assert.equal(created.submissionDate, '2026-10-16');
    assert.equal(created.tournament, 'Autumn Cup');
    assert.equal(created.roundName, 'Final');
    assert.equal(created.player1, 'Player One');
    assert.equal(created.player2, 'Player Two');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = originalToken;
    if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
    else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
  }
});
