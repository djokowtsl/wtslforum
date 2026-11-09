import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = require('next/dist/build/swc').transformSync(source, {
    jsc: {
      parser: { syntax: 'typescript', tsx: path.endsWith('.tsx') },
      target: 'es2022',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    if (name === './liveBroadcast') return load('lib/liveBroadcast.ts');
    if (name === './liveScoreModel') return load('lib/liveScoreModel.ts');
    if (name === '@/lib/liveDmoUmpireScoreSource') return load('lib/liveDmoUmpireScoreSource.ts');
    if (name === 'zod') return require('zod');
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const helpers = load('lib/liveBroadcastScore.ts');
const checkedAt = new Date().toISOString();
const feed = (score = '5/7 7/5 0/1 -- 40:0•') => ({
  checkedAt,
  matches: [{ name: 'Madferit vs gifu', bestOf: 3, score }],
});

test('the reported live score preserves all sets, games, points, and server', () => {
  assert.deepEqual(helpers.scoreForLiveBroadcast(feed(), ['Madferit', 'gifu'], 3), {
    sets: [[5, 7], [7, 5]], games: [0, 1], pointText: ['40', '0'],
    tiebreak: false, server: 2, checkedAt,
  });
});

test('reversing displayed names reverses every score column and the serve indicator', () => {
  const result = helpers.scoreForLiveBroadcast(feed(), ['GIFU', 'Madferit'], 3);
  assert.deepEqual(result.sets, [[7, 5], [5, 7]]);
  assert.deepEqual(result.games, [1, 0]);
  assert.deepEqual(result.pointText, ['0', '40']);
  assert.equal(result.server, 1);
  assert.equal(helpers.scoreForLiveBroadcast(feed('0/1 -- •15:30'), ['gifu', 'Madferit'], 3).server, 2);
});

test('handles deuce, advantage, tiebreak points, and absent serving markers', () => {
  assert.deepEqual(helpers.parseLiveBroadcastScore('5/7 7/5 1/3 -- •40:40', checkedAt).pointText, ['40', '40']);
  assert.deepEqual(helpers.parseLiveBroadcastScore('1/3 -- AD:40•', checkedAt).pointText, ['AD', '40']);
  const tb = helpers.parseLiveBroadcastScore('7/6(5) 6/6 -- •5:6', checkedAt);
  assert.equal(tb.tiebreak, true);
  assert.deepEqual(tb.sets, [[7, 6]]);
  assert.deepEqual(tb.pointText, ['5', '6']);
  assert.equal(helpers.parseLiveBroadcastScore('0/0 -- 0:0', checkedAt).server, null);
});

test('uses ranked aliases and abbreviations without inferring player order', () => {
  const rankedFeed = feed();
  rankedFeed.matches[0].rankedPlayers = ['Madferit', 'gifu'];
  assert.ok(helpers.scoreForLiveBroadcast(rankedFeed, ['[Fake] Madferit', 'gifu'], 3));
  assert.equal(helpers.scoreForLiveBroadcast(feed(), ['[Fake] Madferit', 'gifu'], 3), null);
  const abbreviated = {
    checkedAt,
    matches: [{
      name: 'F.Franchicha vs gifu', bestOf: 3, score: '2/4 -- •15:40',
      rankedPlayers: ['Franky Franchicha', 'gifu'],
    }],
  };
  const score = helpers.scoreForLiveBroadcast(abbreviated, ['gifu', 'Franky Franchicha'], 3);
  assert.deepEqual(score.games, [4, 2]);
  assert.equal(score.server, 2);
});

test('never guesses when the feed, match, format, or player identity is uncertain', () => {
  assert.equal(helpers.scoreForLiveBroadcast(null, ['Madferit', 'gifu'], 3), null);
  assert.equal(helpers.scoreForLiveBroadcast(feed(), ['Other', 'gifu'], 3), null);
  assert.equal(helpers.scoreForLiveBroadcast(feed(), ['Madferit', 'gifu'], 5), null);
  assert.equal(helpers.scoreForLiveBroadcast({ ...feed(), matches: [...feed().matches, ...feed().matches] }, ['Madferit', 'gifu'], 3), null);
  for (const raw of ['...', '', '5/7 invalid -- 40:0', '0/0 -- •40:0•', '8/2 -- 0:0', '0/0 -- 999:0', '6/6 -- AD:40']) {
    assert.equal(helpers.parseLiveBroadcastScore(raw, checkedAt), null, raw);
  }
});

const dmoScore = { sets: [[7, 6]], games: [5, 5], points: [3, 1], pointText: ['40', '15'], tiebreak: false, server: 2 };
const snapshot = {
  version: 1, filename: 'LastGame.dmo', stadium: 'Shanghai', players: ['Madferit', 'gifu'],
  bestOf: 3, frameCount: 100, pointCount: 100, court: [], score: dmoScore,
  currentPoint: { number: 101, server: 2, inProgress: true, rallyHits: 2, serveSpeedKmh: null },
  stats: Array.from({ length: 2 }, () => ({
    servicePoints: 10, servicePointsWon: 5, serviceWinRate: 0.5, pointsWon: 10,
    firstServeFaults: 0, acesOrUnreturned: 0,
  })),
  winHistory: [0.5], recentPoints: [],
};

test('the rendered automatic scoreboard uses TE4 data, without changing the DMO court snapshot', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  let courtSnapshot;
  let courtBuffering = false;
  let courtScoreboard;
  const Display = load('components/DmoLiveDisplay.tsx', {
    '@/lib/te4DmoLive': { LIVE_DMO_FRAME_STALL_MS: 5_000 },
    '@/lib/te4DmoSurface': { surfaceForDmoTournament: () => 'hard' },
    './DmoLiveCourt3D': {
      __esModule: true,
      default: ({ snapshot: value, buffering, scoreboard }) => {
        courtSnapshot = value;
        courtBuffering = buffering;
        courtScoreboard = scoreboard;
        return null;
      },
    },
    './DmoLiveDisplay.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
  }).default;
  const render = (props = {}) => renderToStaticMarkup(React.createElement(Display, {
    snapshot, state: 'live', scoreSource: 'te4', ...props,
  }));
  const html = render({ liveScore: helpers.scoreForLiveBroadcast(feed(), snapshot.players, 3) });
  assert.match(html, /5–7  7–5/);
  assert.doesNotMatch(html, /7–6/);
  assert.match(html, /TE4 live score/);
  assert.equal(courtSnapshot, snapshot);
  assert.equal(courtBuffering, false);
  assert.equal(courtScoreboard.live, true);
  assert.deepEqual(courtScoreboard.score.sets, [[5, 7], [7, 5]]);
  assert.deepEqual(courtScoreboard.score.games, [0, 1]);
  render({ stale: true });
  assert.equal(courtBuffering, true);
  assert.deepEqual(snapshot.score, dmoScore);
  const unavailable = render({ liveScore: null });
  assert.match(unavailable, /Live score temporarily unavailable/);
  assert.doesNotMatch(unavailable, /7–6/);
  assert.equal(courtScoreboard.live, true);
  assert.equal(courtScoreboard.score, null, 'automatic live scoreboards do not fall back to reconstructed DMO data');
  assert.match(render({ scoreSource: 'dmo' }), /7–6/);
  assert.equal(courtScoreboard.live, true, 'manual live DMO calls pair the local score with DMO point ends');
  assert.deepEqual(courtScoreboard.score.games, dmoScore.games);
  render({ scoreSource: 'replay' });
  assert.equal(courtScoreboard.live, false);
  assert.deepEqual(courtScoreboard.score.games, dmoScore.games);
});

test('the court buffering overlay clearly announces delays and stays absent when the feed is fresh', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Overlay = load('components/DmoLiveBufferingOverlay.tsx', {
    './DmoLiveBufferingOverlay.module.css': {
      __esModule: true,
      default: new Proxy({}, { get: (_, key) => key }),
    },
  }).default;
  const buffered = renderToStaticMarkup(React.createElement(Overlay, { buffering: true }));
  assert.match(buffered, /role="status"/);
  assert.match(buffered, /<strong>Buffering<\/strong>/);
  assert.doesNotMatch(buffered, /Buffering live court/);
  assert.match(buffered, /Waiting for the next match update/);
  assert.equal(renderToStaticMarkup(React.createElement(Overlay, { buffering: false })), '');
});

test('broadcast court headings use Live and do not display court surface badges', () => {
  const fallback = readFileSync(new URL('../components/DmoLiveCourt.tsx', import.meta.url), 'utf8');
  const threeDimensional = readFileSync(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
  const threeDimensionalStyles = readFileSync(new URL('../components/DmoLiveCourt3D.module.css', import.meta.url), 'utf8');
  assert.match(fallback, /<strong>LIVE<\/strong>/);
  assert.match(threeDimensional, /fullReplay \? 'FULL MATCH REPLAY' : 'LIVE'/);
  assert.doesNotMatch(fallback, /LIVE COURT/);
  assert.doesNotMatch(threeDimensional, /LIVE COURT|surfaceBadge|Court surface:/);
  assert.doesNotMatch(threeDimensionalStyles, /surfaceBadge/);
});

const nextServer = { after: () => {}, NextResponse: { json: (body, init) => Response.json(body, init) } };
function currentRoute(payload, { feedValue = feed(), signedIn = true, path = 'current' } = {}) {
  let feedCalls = 0;
  const route = load(`app/api/live-dmo/${path}/route.ts`, {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => signedIn ? { discordId: 'viewer', isAdmin: true } : null },
    '@/lib/db': { sql: async () => [{
      id: 'live-match', owner_discord_id: 'owner', owner_name: 'Broadcaster',
      status: 'live', started_at: checkedAt, updated_at: checkedAt,
      sequence: 1, stale: false, payload,
    }] },
    '@/lib/liveDmoStorage': { cleanupExpiredLiveDmoBroadcasts: async () => {}, isLiveDmoReplayPath: () => false },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: (request) => request.headers.get('origin') === 'https://forum.test' },
    '@/lib/te4DmoLive': { hasCompletedDmoPoints: (value) => Boolean(value?.pointCount) },
    '@/lib/liveScores': { getLiveBroadcastScoreFeed: async () => {
      feedCalls++;
      return typeof feedValue === 'function' ? feedValue() : feedValue;
    } },
    '@/lib/liveBroadcastScore': helpers,
  });
  return { route, feedCalls: () => feedCalls };
}

test('snapshot delivery never waits for the official score service', async () => {
  const payload = { snapshot, mode: 'auto', replay: false, players: snapshot.players };
  const { route, feedCalls } = currentRoute(payload, {
    feedValue: () => { throw new Error('Snapshot reads must not invoke the score service'); },
  });
  const response = await route.GET();
  const body = await response.json();
  assert.equal(body.broadcast.liveScore, undefined);
  assert.deepEqual(body.broadcast.snapshot.score, dmoScore);
  assert.equal(feedCalls(), 0);
  assert.ok(body.transport.servedAt);
  assert.ok(body.transport.readDurationMs >= 0);
  assert.match(response.headers.get('server-timing'), /snapshot;dur=/);
  assert.deepEqual(payload.snapshot.score, dmoScore);
});

test('missing live feeds return unavailable, not DMO score; guests cannot fetch live scores', async () => {
  const payload = { snapshot, mode: 'auto', replay: false };
  const unavailable = currentRoute(payload, { feedValue: null, path: 'scores' });
  assert.equal((await (await unavailable.route.GET()).json()).scores['live-match'], null);
  const guest = currentRoute(payload, { signedIn: false, path: 'scores' });
  assert.equal((await guest.route.GET()).status, 401);
  assert.equal(guest.feedCalls(), 0);
});

test('official scores load independently while court snapshots continue during a slow score request', async () => {
  const payload = { snapshot, mode: 'auto', replay: false, players: snapshot.players };
  let release;
  const pendingFeed = new Promise(resolve => { release = resolve; });
  const scores = currentRoute(payload, { path: 'scores', feedValue: () => pendingFeed });
  const scoreResponse = scores.route.GET();
  const snapshots = currentRoute(payload);
  try {
    const response = await snapshots.route.GET();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).broadcast.snapshot.score, dmoScore);
    assert.equal(snapshots.feedCalls(), 0);
  } finally {
    release(feed());
  }
  const response = await scoreResponse;
  const body = await response.json();
  assert.deepEqual(body.scores['live-match'].games, [0, 1]);
  assert.equal(body.scores['live-match'].checkedAt, checkedAt);
  assert.match(response.headers.get('server-timing'), /scores;dur=/);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('the score endpoint selects only current automatic non-replay broadcasts', async () => {
  let feedCalls = 0;
  const route = load('app/api/live-dmo/scores/route.ts', {
    'next/server': nextServer,
    '@/lib/auth': { getSession: async () => ({ discordId: 'viewer' }) },
    '@/lib/db': { sql: async (strings) => {
      const query = strings.join('');
      assert.match(query, /status='live'/);
      assert.match(query, /expires_at > NOW\(\)/);
      assert.match(query, /payload->>'mode'='auto'/);
      assert.match(query, /COALESCE\(payload->>'replay', 'false'\)<>'true'/);
      return [];
    } },
    '@/lib/liveScores': { getLiveBroadcastScoreFeed: async () => { feedCalls++; return feed(); } },
    '@/lib/liveBroadcastScore': helpers,
  });
  assert.deepEqual((await (await route.GET()).json()).scores, {});
  assert.equal(feedCalls, 0);
});

test('score endpoint failures are explicit and do not affect the snapshot endpoint', async () => {
  const payload = { snapshot, mode: 'auto', replay: false };
  const scores = currentRoute(payload, { path: 'scores', feedValue: () => { throw new Error('Database offline'); } });
  assert.equal((await scores.route.GET()).status, 503);
  const snapshots = currentRoute(payload);
  assert.equal((await snapshots.route.GET()).status, 200);
});

test('snapshot reads defer external cleanup until after the response and coalesce scheduling', async () => {
  const scheduled = [];
  let cleanupCalls = 0;
  const route = load('app/api/live-dmo/current/route.ts', {
    'next/server': { ...nextServer, after: callback => scheduled.push(callback) },
    '@/lib/auth': { getSession: async () => ({ discordId: 'viewer' }) },
    '@/lib/db': { sql: async () => [] },
    '@/lib/liveDmoStorage': {
      cleanupExpiredLiveDmoBroadcasts: async () => { cleanupCalls++; },
      isLiveDmoReplayPath: () => false,
    },
    '@/lib/te4DmoLive': { hasCompletedDmoPoints: () => true },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
  });
  const response = await route.GET();
  assert.equal(response.status, 200);
  assert.equal(cleanupCalls, 0);
  assert.equal(scheduled.length, 1);
  assert.equal((await route.GET()).status, 200);
  assert.equal(scheduled.length, 1);
  await scheduled[0]();
  assert.equal(cleanupCalls, 1);
});

test('received official scores expire rather than remain silently stale', () => {
  const { freshLiveDmoScore } = load('lib/liveDmoRefresh.ts');
  const score = helpers.scoreForLiveBroadcast(feed(), snapshot.players, 3);
  const entry = { score, receivedAt: 10_000 };
  assert.equal(freshLiveDmoScore(entry, 14_999), score);
  assert.equal(freshLiveDmoScore(entry, 15_000), null);
  assert.equal(freshLiveDmoScore(undefined), null);
});

test('a stalled response body is aborted and releases the refresh deadline', async (t) => {
  const originalFetch = globalThis.fetch;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = async (_url, { signal, cache }) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      assert.equal(cache, 'no-store');
      signal.addEventListener('abort', () => reject(new Error('Aborted body')), { once: true });
    }),
  });
  try {
    const { fetchLiveDmoJson } = load('lib/liveDmoRefresh.ts');
    const request = fetchLiveDmoJson('/api/live-dmo/current', new AbortController().signal);
    await Promise.resolve();
    const rejected = assert.rejects(request, /Aborted body/);
    t.mock.timers.tick(5_000);
    await rejected;
  } finally {
    globalThis.fetch = originalFetch;
    t.mock.timers.reset();
  }
});

test('manual broadcasts and historical replays neither request nor override live scores', async () => {
  for (const payload of [{ snapshot, mode: 'manual' }, { snapshot, mode: 'auto', replay: true }]) {
    const { route, feedCalls } = currentRoute(payload);
    const body = await (await route.GET()).json();
    assert.equal(body.broadcast.liveScore, undefined);
    assert.deepEqual(body.broadcast.snapshot.score, dmoScore);
    assert.equal(feedCalls(), 0);
  }
});

test('live score service coalesces readers, uses no-store with a short timeout, and does not retain a failed score', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  let calls = 0;
  let fail = false;
  Date.now = () => now;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal);
    if (fail) return new Response('', { status: 503 });
    return new Response('0 10E1 "Madferit vs gifu" 18198E42 190 C98 29A "ATP - XKT(WTSL) v4.4i" "5/7 7/5 0/1 -- 40:0•" 919 2 64 "0119 Shanghai ATP 1000" 6ADBA97E');
  };
  try {
    const service = load('lib/liveScores.ts', {
      './db': { sql: async () => [] },
      './queries': { normalizePlayerName: (value) => value.toLowerCase() },
      './clutchStats': {},
      './wtsl': {},
    });
    const results = await Promise.all([service.getLiveBroadcastScoreFeed(), service.getLiveBroadcastScoreFeed()]);
    assert.equal(calls, 1);
    assert.equal(results[0], results[1]);
    assert.equal(results[0].matches[0].score, '5/7 7/5 0/1 -- 40:0•');
    await service.getLiveBroadcastScoreFeed();
    assert.equal(calls, 1);
    now += 1_001;
    fail = true;
    assert.equal(await service.getLiveBroadcastScoreFeed(), null);
    assert.equal(calls, 2);
    fail = false;
    now += 1_001;
    assert.ok(await service.getLiveBroadcastScoreFeed());
    assert.equal(calls, 3);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});
