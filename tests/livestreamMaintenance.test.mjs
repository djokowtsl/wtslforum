import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Maintenance = () => null;
const untouched = new Proxy({}, {
  get: (_target, name) => {
    if (name === '__esModule') return true;
    return () => { throw new Error(`Protected dependency was called: ${String(name)}`); };
  },
});

function load(path, user, overrides = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = require('next/dist/build/swc').transformSync(source, {
    jsc: {
      parser: { syntax: 'typescript', tsx: true },
      target: 'es2022',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in overrides) return overrides[name];
    if (name === '@/lib/auth') return { getSession: async () => user };
    if (name === '@/components/LivestreamMaintenance') return { __esModule: true, default: Maintenance };
    if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (name === '@/lib/liveRequestSecurity') return { isSameSiteMutation: () => true };
    if (name === 'zod' || name === 'react/jsx-runtime' || name.startsWith('node:')) return require(name);
    return untouched;
  }, module, module.exports);
  return module.exports;
}

const pages = [
  'app/livestreams/page.tsx',
  'app/livestreams/viewer/page.tsx',
  'app/replays/page.tsx',
];
const reads = [
  'app/api/live-dmo/current/route.ts',
  'app/api/live-dmo/[id]/replay/route.ts',
  'app/api/live-dmo/[id]/points/route.ts',
  'app/api/live-dmo/[id]/pre-match/route.ts',
  'app/api/live-dmo/[id]/comments/route.ts',
  'app/api/dmo-replays/route.ts',
  'app/api/dmo-replays/[id]/route.ts',
  'app/api/dmo-replays/[id]/replay/route.ts',
];
const roles = [
  ['guest', null, 401],
  ['member', { id: '1', isAdmin: false }, 403],
  ['moderator', { id: '2', isAdmin: false, isModerator: true }, 403],
];

for (const [role, user, status] of roles) {
  for (const path of pages) {
    test(`${role} sees only the maintenance notice at ${path}`, async () => {
      const page = await load(path, user).default({ searchParams: Promise.resolve({ match: '9' }) });
      assert.equal(page.type, Maintenance);
    });
  }
  for (const path of reads) {
    test(`${role} cannot fetch protected viewer data from ${path}`, async () => {
      const response = await load(path, user).GET(
        new Request('https://forum.test/api/viewer'),
        { params: Promise.resolve({ id: '9' }) },
      );
      assert.equal(response.status, status);
      assert.match(response.headers.get('cache-control'), /private.*no-store/);
    });
  }
  for (const path of ['app/api/live-dmo/current/route.ts', 'app/api/live-dmo/[id]/comments/route.ts']) {
    test(`${role} cannot submit viewer presence or chat to ${path}`, async () => {
      const response = await load(path, user).POST(
        new Request('https://forum.test/api/viewer', { method: 'POST' }),
        { params: Promise.resolve({ id: '9' }) },
      );
      assert.equal(response.status, status);
    });
  }
}

for (const path of pages) {
  test(`a signed-in admin retains the real page at ${path}`, async () => {
    const page = await load(path, { isAdmin: true, username: 'Admin' }, {
      '@/lib/dmoReplayLibrary': { listPublicDmoReplays: async () => ({ replays: [] }) },
    }).default({ searchParams: Promise.resolve({}) });
    assert.notEqual(page.type, Maintenance);
  });
}
