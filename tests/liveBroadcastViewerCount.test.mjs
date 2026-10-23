import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };

function loadRoute({ user = { discordId: 'trusted-member' }, rows = [
  { viewer_count: 3, display_name: 'Ada Fan', avatar_url: 'https://cdn.discordapp.com/avatars/123/a.png' },
  { viewer_count: 3, display_name: 'Lee Rally', avatar_url: null },
  { viewer_count: 3, display_name: 'Sam Serve', avatar_url: null },
] } = {}) {
  const source = readFileSync(new URL('../app/api/live-dmo/current/route.ts', import.meta.url), 'utf8');
  const { code } = require('next/dist/build/swc').transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const queries = [];
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name === 'next/server') return nextServer;
    if (name === 'zod') return require('zod');
    if (name === '@/lib/auth') return { getSession: async () => user };
    if (name === '@/lib/db') return {
      sql: async (strings, ...values) => {
        queries.push({ text: strings.join(' '), values });
        return rows;
      },
    };
    if (name === '@/lib/te4DmoLive') return { hasCompletedDmoPoints: (snapshot) => Boolean(snapshot?.pointCount) };
    if (name === '@/lib/liveDmoStorage') return {
      cleanupExpiredLiveDmoBroadcasts: async () => {},
      isLiveDmoReplayPath: () => false,
    };
    if (name === '@/lib/liveRequestSecurity') return {
      isSameSiteMutation: (request) => request.headers.get('origin') === 'https://forum.test',
    };
    if (name === '@/lib/liveScores') return { getLiveBroadcastScoreFeed: async () => null };
    if (name === '@/lib/liveBroadcastScore') return { scoreForLiveBroadcast: () => null };
    throw new Error(`Unexpected route dependency: ${name}`);
  }, module, module.exports);
  return { ...module.exports, queries };
}

function heartbeatRequest(body, { origin = 'https://forum.test', length } = {}) {
  return new Request('https://forum.test/api/live-dmo/current', {
    method: 'POST',
    headers: {
      ...(origin ? { Origin: origin } : {}),
      'Content-Type': 'application/json',
      ...(length ? { 'Content-Length': String(length) } : {}),
    },
    body,
  });
}

test('a same-site signed-in heartbeat registers one account and returns only the active viewer total', async () => {
  const { POST, queries } = loadRoute();
  const broadcastId = 'f50f6da6-271e-4a02-aac9-ae18c084443f';
  const response = await POST(heartbeatRequest(JSON.stringify({ broadcastId })));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    viewerCount: 3,
    viewers: [
      { displayName: 'Ada Fan', avatarUrl: 'https://cdn.discordapp.com/avatars/123/a.png' },
      { displayName: 'Lee Rally', avatarUrl: null },
      { displayName: 'Sam Serve', avatarUrl: null },
    ],
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /INSERT INTO dmo_live_broadcast_viewers/);
  assert.match(queries[0].text, /ON CONFLICT \(broadcast_id, viewer_discord_id\)/);
  assert.match(queries[0].text, /status='live' AND expires_at > NOW\(\)/);
  assert.match(queries[0].text, /last_seen_at > NOW\(\) - INTERVAL '45 seconds'/);
  assert.match(queries[0].text, /LEFT JOIN users u ON u.discord_id=v.viewer_discord_id/);
  assert.ok(queries[0].values.includes(broadcastId));
  assert.ok(queries[0].values.includes('trusted-member'));
  const serialized = JSON.stringify(await (await POST(heartbeatRequest(JSON.stringify({ broadcastId })))).json());
  assert.doesNotMatch(serialized, /trusted-member/);
});

test('heartbeats reject cross-site, guest, oversized, malformed, and non-live requests before counting viewers', async () => {
  const broadcastId = 'f50f6da6-271e-4a02-aac9-ae18c084443f';
  const crossSite = loadRoute();
  assert.equal((await crossSite.POST(heartbeatRequest(JSON.stringify({ broadcastId }), { origin: 'https://attacker.test' }))).status, 403);
  assert.equal(crossSite.queries.length, 0);

  const guest = loadRoute({ user: null });
  assert.equal((await guest.POST(heartbeatRequest(JSON.stringify({ broadcastId })))).status, 401);
  assert.equal(guest.queries.length, 0);

  const oversized = loadRoute();
  assert.equal((await oversized.POST(heartbeatRequest(' '.repeat(513)))).status, 413);
  assert.equal(oversized.queries.length, 0);

  const malformed = loadRoute();
  assert.equal((await malformed.POST(heartbeatRequest('{'))).status, 400);
  assert.equal((await malformed.POST(heartbeatRequest(JSON.stringify({ broadcastId, discordId: 'fake' })))).status, 400);
  assert.equal(malformed.queries.length, 0);

  const inactive = loadRoute({ rows: [] });
  assert.equal((await inactive.POST(heartbeatRequest(JSON.stringify({ broadcastId })))).status, 404);
  assert.equal(inactive.queries.length, 1);
});

test('the current-stream refresh does not perform an extra viewer-count query', async () => {
  const route = loadRoute({
    rows: [{
      id: 'broadcast-id', owner_discord_id: 'owner', owner_name: 'Broadcaster',
      status: 'live', started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      sequence: 1, stale: false, payload: { stream: null },
    }],
  });
  const response = await route.GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.broadcast.viewerCount, undefined);
  assert.equal(body.broadcast.broadcastMode, 'manual');
  assert.doesNotMatch(route.queries[0].text, /dmo_live_broadcast_viewers/);
});

test('the UI shows live counts for the active non-replay card with clear unavailable and privacy labels', () => {
  const viewer = readFileSync(new URL('../components/DmoLiveViewer.tsx', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../components/DmoLiveViewer.module.css', import.meta.url), 'utf8');
  assert.match(viewer, /setInterval\(\(\) => \{ void sendHeartbeat\(\); \}, 15_000\)/);
  assert.match(viewer, /document\.visibilityState !== 'visible'/);
  assert.match(viewer, /broadcast\.status === 'live' && !broadcast\.replay/);
  assert.match(viewer, /Signed-in viewers active in the last 45 seconds/);
  assert.match(viewer, /Viewers unavailable/);
  assert.match(viewer, /Checking…/);
  assert.match(viewer, /broadcast\.viewers\?\.map/);
  assert.match(viewer, /Signed-in viewers/);
  assert.match(viewer, /<Eye size=\{13\} aria-hidden="true" \/>/);
  assert.match(styles, /\.viewerCount \{/);
  assert.match(styles, /\.viewerRoster \{/);

  const chat = readFileSync(new URL('../components/LiveBroadcastComments.tsx', import.meta.url), 'utf8');
  assert.match(chat, /<h3>Live chat<\/h3>/);
  assert.match(chat, /authorAvatar/);
  assert.match(chat, /5_000/);
});
