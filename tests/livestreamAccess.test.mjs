import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LIVE_ID = '00000000-0000-4000-8000-000000000009';
const LiveHost = () => null;
const LiveViewer = () => null;
const ReplayLibrary = () => null;
const PageHero = () => null;
const untouched = new Proxy({}, {
  get: (_target, name) => {
    if (name === '__esModule') return true;
    return () => { throw new Error(`Protected dependency was called: ${String(name)}`); };
  },
});

const mocks = {
  'next/server': { after: () => {}, NextResponse: { json: (body, init) => Response.json(body, init) } },
  '@/lib/db': { sql: async () => [] },
  '@/lib/liveDmoStorage': {
    cleanupExpiredLiveDmoBroadcasts: async () => {},
    isLiveDmoReplayPath: () => false,
  },
  '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
  '@/lib/te4DmoLive': { hasCompletedDmoPoints: () => false },
  '@/lib/spoilers': { spoilerMarkupError: () => null },
  '@/lib/liveScores': { getLiveBroadcastScoreFeed: async () => null },
  '@/lib/liveBroadcastScore': { scoreForLiveBroadcast: () => null },
  '@/lib/dmoReplayLibrary': {
    isDmoReplayId: (id) => /^\d{1,19}$/.test(id),
    listPublicDmoReplays: async () => ({ replays: [], nextCursor: null }),
    getPublicDmoReplay: async () => null,
    publicDmoReplayMetadata: (replay) => replay,
  },
  '@/components/DmoLiveHost': { __esModule: true, default: LiveHost },
  '@/components/DmoLiveViewer': { __esModule: true, default: LiveViewer },
  '@/components/DmoReplayLibrary': { __esModule: true, default: ReplayLibrary },
  '@/components/PageHero': { __esModule: true, default: PageHero },
};

function load(path, user) {
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
    if (name === '@/lib/auth') return { getSession: async () => user };
    if (name in mocks) return mocks[name];
    if (name === 'zod' || name === 'react/jsx-runtime' || name.startsWith('node:')) return require(name);
    return untouched;
  }, module, module.exports);
  return module.exports;
}

function collectElements(node, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, found);
  } else if (node && typeof node === 'object') {
    if ('type' in node) found.push(node);
    collectElements(node.props?.children, found);
  }
  return found;
}

const pages = [
  'app/livestreams/page.tsx',
  'app/livestreams/viewer/page.tsx',
  'app/replays/page.tsx',
];
const viewerReads = [
  'app/api/live-dmo/current/route.ts',
  'app/api/live-dmo/scores/route.ts',
  'app/api/live-dmo/[id]/replay/route.ts',
  'app/api/live-dmo/[id]/points/route.ts',
  'app/api/live-dmo/[id]/pre-match/route.ts',
  'app/api/live-dmo/[id]/comments/route.ts',
  'app/api/dmo-replays/route.ts',
  'app/api/dmo-replays/[id]/route.ts',
  'app/api/dmo-replays/[id]/replay/route.ts',
];
const roles = [
  ['guest', null],
  ['member', { id: '1', discordId: '1001', username: 'Member', isAdmin: false, isModerator: false }],
  ['moderator', { id: '2', discordId: '1002', username: 'Moderator', isAdmin: false, isModerator: true }],
  ['admin', { id: '3', discordId: '1003', username: 'Admin', isAdmin: true, isModerator: false }],
];

for (const [role, user] of roles) {
  for (const path of pages) {
    test(`${role} can open ${path} without the maintenance page`, async () => {
      const page = await load(path, user).default({
        searchParams: Promise.resolve({ match: '21' }),
      });
      const elements = collectElements(page);

      if (path === 'app/replays/page.tsx' && !user) {
        const hero = elements.find((element) => element.type === PageHero);
        assert.ok(hero, 'guests receive a sign-in page for replays');
        assert.equal(hero.props.actions.props.href, '/api/auth/discord');
        assert.match(hero.props.children, /Sign in to browse and watch/);
        return;
      }

      if (path === 'app/replays/page.tsx') {
        assert.ok(elements.some((element) => element.type === ReplayLibrary));
        return;
      }

      const viewer = elements.find((element) => element.type === LiveViewer);
      assert.ok(viewer, 'the live viewer remains available');
      assert.equal(viewer.props.canWatch, Boolean(user));
      if (path === 'app/livestreams/page.tsx') {
        const host = elements.find((element) => element.type === LiveHost);
        assert.equal(Boolean(host), Boolean(user));
        if (host) assert.equal(host.props.canPrepareFullReplay, user.isAdmin);
      }
    });
  }

  for (const path of viewerReads) {
    test(`${role} follows the sign-in policy for ${path}`, async () => {
      const route = load(path, user);
      const isReplayRoute = path.includes('dmo-replays');
      const id = isReplayRoute ? '21' : LIVE_ID;
      const request = new Request('https://forum.test/api/viewer');
      const response = await route.GET(request, { params: Promise.resolve({ id }) });

      if (!user) {
        assert.equal(response.status, 401);
      } else {
        assert.notEqual(response.status, 401);
        assert.notEqual(response.status, 403);
      }
      assert.match(response.headers.get('cache-control'), /private.*no-store/);
    });
  }
}

for (const [role, user] of roles) {
  for (const [path, body, id] of [
    ['app/api/live-dmo/current/route.ts', { broadcastId: LIVE_ID }, undefined],
    ['app/api/live-dmo/[id]/comments/route.ts', { body: 'Nice match' }, LIVE_ID],
  ]) {
    test(`${role} follows the sign-in policy for viewer actions at ${path}`, async () => {
      const response = await load(path, user).POST(
        new Request('https://forum.test/api/viewer', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) },
      );
      if (!user) assert.equal(response.status, 401);
      else {
        assert.notEqual(response.status, 401);
        assert.notEqual(response.status, 403);
      }
    });
  }
}
