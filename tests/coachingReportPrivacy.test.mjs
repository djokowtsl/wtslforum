import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const viewerModule = loadModule('lib/coachingReportViewer.ts', {});
const admin = { id: '7', discordId: 'admin-discord', isAdmin: true };
const reportId = '72123456-1234-4234-9234-123456789abc';
const stagingPath = 'dmo-coaching-report-staging/72123456-1234-4234-9234-123456789abc.json';
const originalStoreId = process.env.MODERATION_BLOB_STORE_ID;

function restoreStoreId() {
  if (originalStoreId === undefined) delete process.env.MODERATION_BLOB_STORE_ID;
  else process.env.MODERATION_BLOB_STORE_ID = originalStoreId;
}

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
    throw new Error(`Unexpected module dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

function request(body) {
  return new Request('https://forum.test/api/admin/coaching-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validViewer() {
  return {
    names: ['Player One', 'Player Two'],
    score: '6-4 6-3',
    tournament: 'WTSL Open',
    surface: 'hard',
    highlights: [{
      point: 1,
      rewatch: '0:00',
      frame: 0,
      set: 1,
      games: '0-0',
      winner: 1,
      wp: 0.7,
      importance: 0.5,
      excitement: 0.8,
      score: 0.6,
      reasons: 'A high-leverage point',
      rally: 4,
    }],
    sets: [[6, 4]],
    final: { ss: [[6, 4]], wp: 1 },
    match: { d: Buffer.alloc(14).toString('base64'), n: 1, fps: 30 },
    pts: [{
      k: 1,
      mf: 0,
      fc: 1,
      ss: [[0, 0]],
      sc: 0,
      rs: '',
      wp: 0.5,
      rt: '0:00',
      set: 1,
      g: '0-0',
      pt: '0-0',
      tb: 0,
      s: 1,
      w: 1,
      f: 0,
      n: 1,
      inferred: false,
      sh: [{
        p: 1,
        t: 0,
        k: 's',
        v: 180,
        z: 0,
        d: 0,
        bx: null,
        by: null,
        bt: null,
        en: 1,
        br: 1,
      }],
    }],
  };
}

function publishBody(overrides = {}) {
  return {
    stagingPath,
    tournament: 'WTSL Open',
    roundName: 'Final',
    consent: { submitter: true, player1: true, player2: true, review: true },
    consentReferences: {
      submitter: 'Submitter consent confirmed in Forum DM.',
      player1: 'Player One consent confirmed in Forum DM.',
      player2: 'Player Two consent confirmed in Forum DM.',
    },
    ...overrides,
  };
}

test('public replay validator keeps only the supported viewer shape', () => {
  const source = validViewer();
  source.privateBlobPath = 'dmo-analysis/source.dmo';
  source.warnings = ['internal review note'];
  const result = viewerModule.sanitizeCoachingViewerData(source);

  assert.ok(result);
  assert.equal(result.names[0], 'Player One');
  assert.equal('privateBlobPath' in result, false);
  assert.equal('warnings' in result, false);
  assert.equal(result.pts[0].rs, '');
});

test('public replay validator rejects inconsistent frame bytes and malformed points', () => {
  const badFrameCount = validViewer();
  badFrameCount.match.n = 2;
  assert.equal(viewerModule.sanitizeCoachingViewerData(badFrameCount), null);

  const badPoint = validViewer();
  badPoint.pts[0].w = 3;
  assert.equal(viewerModule.sanitizeCoachingViewerData(badPoint), null);
});

test('coaching replay staging path accepts only UUID JSON keys in its private prefix', () => {
  assert.equal(viewerModule.isCoachingReplayStagingPath(stagingPath), true);
  assert.equal(viewerModule.isCoachingReplayStagingPath('dmo-coaching-report-staging/../source.json'), false);
  assert.equal(viewerModule.isCoachingReplayStagingPath('dmo-analysis/source.dmo'), false);
});

test('report publication rejects guests before reading private replay data', async () => {
  let privateRead = false;
  const handlers = loadModule('app/api/admin/coaching-reports/route.ts', {
    '@vercel/blob': {
      get: async () => { privateRead = true; },
      put: async () => {},
      del: async () => {},
    },
    'node:crypto': require('node:crypto'),
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { getSession: async () => null },
    '@/lib/db': { sql: async () => [] },
    '@/lib/coachingReportViewer': viewerModule,
  });
  const response = await handlers.POST(request(publishBody()));
  assert.equal(response.status, 403);
  assert.equal(privateRead, false);
});

test('report publication requires each consent and review before private blob access', async () => {
  let privateRead = false;
  process.env.MODERATION_BLOB_STORE_ID = 'private-test-store';
  try {
    const handlers = loadModule('app/api/admin/coaching-reports/route.ts', {
      '@vercel/blob': {
        get: async () => { privateRead = true; },
        put: async () => {},
        del: async () => {},
      },
      'node:crypto': require('node:crypto'),
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { getSession: async () => admin },
      '@/lib/db': { sql: async () => [] },
      '@/lib/coachingReportViewer': viewerModule,
    });
    const response = await handlers.POST(request(publishBody({
      consent: { submitter: true, player1: false, player2: true, review: true },
    })));
    assert.equal(response.status, 400);
    assert.equal(privateRead, false);
  } finally {
    restoreStoreId();
  }
});

test('report publication saves a sanitized replay privately and deletes the staging object', async () => {
  process.env.MODERATION_BLOB_STORE_ID = 'private-test-store';
  try {
    const calls = { gets: [], puts: [], deletes: [], queries: [] };
    const handlers = loadModule('app/api/admin/coaching-reports/route.ts', {
      '@vercel/blob': {
        get: async (...args) => {
          calls.gets.push(args);
          const body = JSON.stringify(validViewer());
          return {
            statusCode: 200,
            stream: new Response(body).body,
            blob: { size: Buffer.byteLength(body) },
          };
        },
        put: async (...args) => calls.puts.push(args),
        del: async (...args) => calls.deletes.push(args),
      },
      'node:crypto': { randomUUID: () => reportId },
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { getSession: async () => admin },
      '@/lib/db': {
        sql: async (strings, ...values) => {
          calls.queries.push({ text: strings.join('?'), values });
          return calls.queries.length === 1 ? [] : [{ id: reportId }];
        },
      },
      '@/lib/coachingReportViewer': viewerModule,
    });
    const response = await handlers.POST(request(publishBody()));

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      id: reportId,
      title: 'WTSL Open — Final: Player One vs Player Two',
    });
    assert.equal(calls.gets[0][0], stagingPath);
    assert.equal(calls.gets[0][1].access, 'private');
    assert.equal(calls.puts.length, 1);
    assert.match(calls.puts[0][0], /^dmo-coaching-replays\//);
    assert.equal(calls.puts[0][2].access, 'private');
    assert.equal(calls.queries[1].values.includes('admin-discord'), true);
    assert.deepEqual(calls.deletes, [[stagingPath, { storeId: 'private-test-store' }]]);
  } finally {
    restoreStoreId();
  }
});

test('public replay endpoint does not read private storage for unpublished reports', async () => {
  let privateRead = false;
  const handlers = loadModule('app/api/coaching-reports/[id]/replay/route.ts', {
    '@vercel/blob': { get: async () => { privateRead = true; } },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/coachingReports': { getPublishedCoachingReplayPath: async () => null },
    '@/lib/coachingReportViewer': { MAX_COACHING_REPLAY_BYTES: 64 * 1024 * 1024 },
  });
  const response = await handlers.GET(new Request('https://forum.test'), {
    params: Promise.resolve({ id: reportId }),
  });
  assert.equal(response.status, 404);
  assert.equal(privateRead, false);
});

test('unpublishing is admin-only and marks the public record private before blob cleanup', async () => {
  let queryCalled = false;
  let deleteCalled = false;
  const guestHandlers = loadModule('app/api/admin/coaching-reports/[id]/route.ts', {
    '@vercel/blob': { del: async () => { deleteCalled = true; } },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { getSession: async () => null },
    '@/lib/db': { sql: async () => { queryCalled = true; return []; } },
  });
  const denied = await guestHandlers.DELETE(new Request('https://forum.test'), {
    params: Promise.resolve({ id: reportId }),
  });
  assert.equal(denied.status, 403);
  assert.equal(queryCalled, false);
  assert.equal(deleteCalled, false);

  process.env.MODERATION_BLOB_STORE_ID = 'private-test-store';
  try {
    const order = [];
    const adminHandlers = loadModule('app/api/admin/coaching-reports/[id]/route.ts', {
      '@vercel/blob': {
        del: async () => { order.push('delete-private-replay'); },
      },
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { getSession: async () => admin },
      '@/lib/db': {
        sql: async () => {
          order.push('unpublish-database-row');
          return [{ replay_pathname: 'dmo-coaching-replays/72123456-1234-4234-9234-123456789abc.json' }];
        },
      },
    });
    const response = await adminHandlers.DELETE(new Request('https://forum.test'), {
      params: Promise.resolve({ id: reportId }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(order, ['unpublish-database-row', 'delete-private-replay']);
  } finally {
    restoreStoreId();
  }
});

test('admin can retry private replay cleanup after a report is already unpublished', async () => {
  process.env.MODERATION_BLOB_STORE_ID = 'private-test-store';
  try {
    const calls = [];
    const handlers = loadModule('app/api/admin/coaching-reports/[id]/route.ts', {
      '@vercel/blob': {
        del: async (...args) => calls.push(['delete-private-replay', ...args]),
      },
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { getSession: async () => admin },
      '@/lib/db': {
        sql: async () => {
          calls.push(['update-or-select']);
          return calls.length === 1 ? [] : [{ unpublished_at: new Date().toISOString() }];
        },
      },
    });
    const response = await handlers.DELETE(new Request('https://forum.test'), {
      params: Promise.resolve({ id: reportId }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      ['update-or-select'],
      ['update-or-select'],
      ['delete-private-replay', `dmo-coaching-replays/${reportId}.json`, { storeId: 'private-test-store' }],
    ]);
  } finally {
    restoreStoreId();
  }
});
