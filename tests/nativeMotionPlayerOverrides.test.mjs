import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
function load(path, mocks = {}) {
  const { code } = transformSync(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    return require(name);
  }, module, module.exports);
  return module.exports;
}
const catalogData = load('lib/nativeMotionCatalogData.ts');
const characterGrunts = {
  dmoCharacterNameKey: (name) => String(name ?? '').toLowerCase(),
  getDmoCharacterGruntSetting: (name) => ({
    groupId: name ? `profile-${String(name).toLowerCase()}` : null,
    useGenericFallback: true,
  }),
  isDmoCharacterGruntGroup: (group) => group === 'male-aliassime',
};
const pick = { clipId: 'a1_b1', sourceHandedness: 'right' };
const alternate = { clipId: 'a2_b2', sourceHandedness: 'left' };
const broadcastId = 'd2917824-65d4-4c7f-976c-ac30004eb253';
function setup(options = {}) {
  const calls = [];
  const writes = [];
  let catalogFetches = 0;
  const route = load('app/api/admin/native-motion/player-overrides/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/auth': { getSession: async () => options.user === undefined ? { isAdmin: true } : options.user },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => options.sameSite !== false },
    '@/lib/dmoReplayLibrary': { isDmoReplayId: (id) => /^[1-9]\d{0,18}$/.test(id) },
    '@/lib/nativeMotionCatalogData': catalogData,
    '@/lib/dmoCharacterAppearance.mjs': characterGrunts,
    '@/lib/nativeMotionServer': {
      fetchNativeMotionCatalog: async () => {
        catalogFetches += 1;
        return {
          clips: [
            { id: 'a1_b1', duration: 1, events: { kind: 'strike', contactTime: 0.5 }, hidden: true, accelerationVariant: true },
            { id: 'a2_b2', duration: 1, events: { kind: 'serve', contactTime: 0.5 } },
            { id: 'a5_b5', label: 'Barty-BH-Slice', sourceBundle: 'barty-bh-slice',
              originalClipName: 'barty-bh-slice', duration: 1, events: { kind: 'strike', contactTime: 0.5 } },
          ],
        };
      },
    },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        const text = strings.join('?');
        calls.push({ text, values });
        return options.rows?.(text) ?? (options.exists === false ? [] : [{ id: '17' }]);
      },
      transaction: async (build) => {
        build((strings, ...values) => {
          writes.push({ text: strings.join('?'), values });
          return {};
        });
      },
    },
  });
  return { route, calls, writes, get catalogFetches() { return catalogFetches; } };
}
const request = (body) => new Request('https://forum.test/api/admin/native-motion/player-overrides', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const body = (overrides = {}) => ({
  targetType: 'replay', targetId: '17', playerClips: [{ forehand: pick }, {}], ...overrides,
});

test('character profiles persist slice choices, clear them, and keep legacy automatic profiles valid', async () => {
  const writes = [];
  const route = load('app/api/admin/native-motion/profiles/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/auth': { getSession: async () => ({ isAdmin: true }) },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => true },
    '@/lib/nativeMotionCatalogData': catalogData,
    '@/lib/nativeMotionServer': {
      fetchNativeMotionCatalog: async () => ({ clips: [
        { id: 'a1_b1', duration: 1, events: { kind: 'strike', contactTime: 0.5 } },
        { id: 'a2_b2', duration: 1, events: { kind: 'serve', contactTime: 0.5 } },
        { id: 'a5_b5', label: 'Barty-BH-Slice', sourceBundle: 'barty-bh-slice',
          duration: 1, events: { kind: 'strike', contactTime: 0.5 } },
      ] }),
    },
    '@/lib/db': { sql: async (strings, ...values) => { writes.push(values); return []; } },
  });
  const slice = { clipId: 'a5_b5', sourceHandedness: 'right' };
  const payload = { characterName: 'Barty', automaticFallback: false,
    clips: { backhand: pick, 'slice-backhand': slice } };
  const saved = await route.PUT(request(payload));
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).profile.clips, payload.clips);
  const cleared = await route.PUT(request({
    ...payload, clips: { backhand: pick, 'slice-backhand': null },
  }));
  assert.deepEqual((await cleared.json()).profile.clips, { backhand: pick });
  const fallback = await route.PUT(request({
    automaticFallback: true,
    clips: { forehand: pick, backhand: pick, serve: alternate },
  }));
  assert.equal(fallback.status, 200);
  const invalid = await route.PUT(request({
    ...payload, clips: { 'slice-forehand': slice },
  }));
  assert.equal(invalid.status, 400);
  assert.equal(writes.length, 3);
});

test('guests, members, and cross-site requests cannot change match animations', async () => {
  for (const options of [{ user: null }, { user: { isAdmin: false } }, { sameSite: false }]) {
    const { route, calls, writes } = setup(options);
    assert.equal((await route.PUT(request(body()))).status, 403);
    assert.equal(calls.length, 0);
    assert.equal(writes.length, 0);
  }
});

test('a replay accepts an arbitrary compatible variant without character restrictions', async () => {
  const { route, writes } = setup();
  assert.equal((await route.PUT(request(body()))).status, 200);
  assert.equal(writes.length, 2);
  assert.match(writes[0].text, /DELETE.+submission_id/s);
  assert.deepEqual(writes[1].values, ['17', 0, JSON.stringify({ forehand: pick })]);
});

test('per-player slice selections are saved for replay and live targets with opposite-side validation', async () => {
  const slice = { clipId: 'a5_b5', sourceHandedness: 'right' };
  for (const target of [
    { targetType: 'replay', targetId: '17' },
    { targetType: 'manual', targetId: broadcastId },
  ]) {
    const { route, writes } = setup();
    const response = await route.PUT(request(body({
      ...target, playerClips: [{ 'slice-backhand': slice }, {}],
    })));
    assert.equal(response.status, 200);
    assert.ok(writes.some((write) => write.values.includes(JSON.stringify({ 'slice-backhand': slice }))));
  }
  const { route, writes } = setup();
  assert.equal((await route.PUT(request(body({
    playerClips: [{ 'slice-forehand': slice }, {}],
  })))).status, 400);
  assert.equal(writes.length, 0);
});

test('each player and stroke is stored separately and clearing restores defaults', async () => {
  const first = setup();
  const response = await first.route.PUT(request(body({ playerClips: [{ forehand: pick }, { serve: alternate }] })));
  assert.equal(response.status, 200);
  assert.equal(first.writes.length, 3);
  assert.deepEqual(first.writes[2].values, ['17', 1, JSON.stringify({ serve: alternate })]);
  const cleared = setup();
  assert.equal((await cleared.route.PUT(request(body({ playerClips: [{}, {}] })))).status, 200);
  assert.equal(cleared.writes.length, 1);
  assert.match(cleared.writes[0].text, /DELETE/);
});

test('admins can assign a grunt bank or silence either match player', async () => {
  const { route, writes } = setup();
  const response = await route.PUT(request(body({
    playerGruntOverrides: [{ gruntGroup: 'male-aliassime' }, { gruntGroup: null }],
  })));
  assert.equal(response.status, 200);
  const gruntWrites = writes.filter((write) => write.text.includes('dmo_character_grunt_match_overrides'));
  assert.equal(gruntWrites.length, 3);
  assert.match(gruntWrites[0].text, /DELETE/);
  assert.deepEqual(gruntWrites[1].values, ['17', 0, 'male-aliassime']);
  assert.deepEqual(gruntWrites[2].values, ['17', 1, null]);
});

test('grunt-only saves preserve animation overrides and do not require the motion catalog', async () => {
  const harness = setup();
  const response = await harness.route.PUT(request({
    targetType: 'replay',
    targetId: '17',
    playerGruntOverrides: [{ gruntGroup: 'male-aliassime' }, { gruntGroup: null }],
  }));
  assert.equal(response.status, 200);
  assert.equal(harness.catalogFetches, 0);
  assert.equal(harness.writes.length, 3);
  assert.ok(harness.writes.every((write) => write.text.includes('dmo_character_grunt_match_overrides')));
});

test('an update must include animation or grunt choices', async () => {
  const { route, writes } = setup();
  const response = await route.PUT(request({ targetType: 'replay', targetId: '17' }));
  assert.equal(response.status, 400);
  assert.equal(writes.length, 0);
});

test('automatic, expired, hidden, and missing targets cannot receive overrides', async () => {
  for (const type of ['replay', 'manual']) {
    const { route, calls, writes } = setup({ exists: false });
    const response = await route.PUT(request(body({ targetType: type, targetId: type === 'replay' ? '17' : broadcastId })));
    assert.equal(response.status, 404);
    assert.equal(writes.length, 0);
    assert.match(calls[0].text, type === 'manual' ? /mode'.+= 'manual'/ : /hidden_at IS NULL/);
  }
});

test('manual streams save the chosen clips under the broadcast, not the character', async () => {
  const { route, writes } = setup();
  assert.equal((await route.PUT(request(body({ targetType: 'manual', targetId: broadcastId })))).status, 200);
  assert.match(writes[1].text, /\(broadcast_id, player_index, clips\)/);
  assert.equal(writes[1].values[0], broadcastId);
});

test('invalid strokes, arrays of alternatives, and missing handedness are rejected', async () => {
  for (const playerClips of [
    [{ forehand: alternate }, {}],
    [{ forehand: [pick, alternate] }, {}],
    [{ forehand: { clipId: 'a1_b1' } }, {}],
  ]) {
    const { route, writes } = setup();
    assert.equal((await route.PUT(request(body({ playerClips })))).status, 400);
    assert.equal(writes.length, 0);
  }
});

test('admin search returns both players’ fixed selections for the selected replay', async () => {
  const harness = setup({ rows: (text) => text.includes('FROM dmo_submissions')
    ? [{
      id: '17', player1: 'elmanzanas', player2: 'Bigwill', player1_character: 'Federer',
      player2_character: 'Djokovic', tournament: 'Shenzhen', round_name: 'Final',
      submitted_at: '2026-11-01', clip_overrides: { 0: { forehand: pick }, 1: { serve: alternate } },
    }] : [] });
  const response = await harness.route.GET(new Request('https://forum.test/api/admin/native-motion/player-overrides?q=Shenzhen'));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.targets[0].playerClips, [{ forehand: pick }, { serve: alternate }]);
  assert.match(harness.calls.find((call) => call.text.includes('FROM dmo_submissions')).text, /OR s\.id::text = \?/);
});

test('replay resolver checks visibility and returns match overrides above optional profiles', async () => {
  const queries = [];
  const mocks = {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/auth': { getSession: async () => null },
    '@/lib/dmoReplayLibrary': {
      isDmoReplayId: () => true,
      getPublicDmoReplay: async () => ({ privateBlobPathname: 'dmo/match.dmo', fileName: 'match.dmo' }),
      getDmoReplaySubmission: async () => { throw new Error('Private replay should not be read for a guest'); },
    },
    '@/lib/nativeMotionCatalogData': catalogData,
    '@/lib/dmoCharacterAppearance.mjs': characterGrunts,
    '@/lib/db': { sql: async (strings) => {
      const text = strings.join('?'); queries.push(text);
      return text.includes('FROM dmo_native_motion_player_overrides') ? [{ player_index: 1, clips: { forehand: pick } }] : [];
    } },
  };
  const route = load('app/api/native-motion/profiles/route.ts', mocks);
  const response = await route.GET(new Request('https://forum.test/api/native-motion/profiles?submissionId=17&player1=Federer&player2=Djokovic'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual((await response.json()).playerClipOverrides, [{}, { forehand: pick }]);
  const hidden = load('app/api/native-motion/profiles/route.ts', {
    ...mocks,
    '@/lib/dmoReplayLibrary': { ...mocks['@/lib/dmoReplayLibrary'], getPublicDmoReplay: async () => null },
  });
  assert.equal((await hidden.GET(new Request('https://forum.test/api/native-motion/profiles?submissionId=17'))).status, 404);
});

test('replay grunt overrides follow replay player order and can explicitly disable audio', async () => {
  const mocks = {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/auth': { getSession: async () => null },
    '@/lib/dmoReplayLibrary': {
      isDmoReplayId: () => true,
      getPublicDmoReplay: async () => ({ privateBlobPathname: 'dmo/match.dmo', fileName: 'match.dmo' }),
      getDmoReplaySubmission: async () => null,
    },
    '@/lib/nativeMotionCatalogData': catalogData,
    '@/lib/dmoCharacterAppearance.mjs': characterGrunts,
    '@/lib/db': { sql: async (strings) => {
      const text = strings.join('?');
      if (text.includes('FROM dmo_character_grunt_profiles')) {
        return [{ profile_key: 'federer', grunt_group: 'male-aliassime' }];
      }
      if (text.includes('FROM dmo_character_grunt_match_overrides')) {
        return [{ player_index: 1, grunt_group: null }];
      }
      return [];
    } },
  };
  const route = load('app/api/native-motion/profiles/route.ts', mocks);
  const response = await route.GET(new Request(
    'https://forum.test/api/native-motion/profiles?submissionId=17&player1=Federer&player2=Djokovic&playerIndex1=1&playerIndex2=0',
  ));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.playerGruntSettings, [
    { groupId: null, useGenericFallback: false },
    { groupId: 'profile-djokovic', useGenericFallback: true },
  ]);
});

test('playback uses one chosen version and preserves player identity when replay order reverses', async () => {
  const changes = [];
  const requests = [];
  const oldFetch = globalThis.fetch;
  let stateIndex = 0;
  let cleanup;
  const clipMetadata = (id) => ({
    id, duration: 1, events: { kind: 'strike', contactTime: 0.5 },
  });
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.startsWith('/api/native-motion/profiles?')) {
      return Response.json({
        playerProfileKeys: ['djokovic', 'federer'],
        profiles: [
          { profileKey: 'djokovic', clips: { forehand: { clipId: 'a3_b3', sourceHandedness: 'right' } } },
          { profileKey: 'federer', clips: {} },
        ],
        playerClipOverrides: [
          { forehand: pick, 'slice-backhand': { ...pick, clipId: 'a5_b5' } },
          { forehand: { ...pick, clipId: 'a4_b4' } },
        ],
      });
    }
    if (url.endsWith('/catalog.json')) return Response.json({
      format: 'WTMC1', rig: { modelHash: 'test-rig' },
      clips: [
        ...['a1_b1', 'a3_b3', 'a4_b4'].map(clipMetadata),
        { ...clipMetadata('a5_b5'), label: 'Barty-BH-Slice', sourceBundle: 'barty-bh-slice', originalClipName: 'barty-bh-slice' },
      ],
    });
    return new Response(new TextEncoder().encode(url.includes('a4_b4') ? 'second-player' : 'first-player'));
  };
  try {
    const hook = load('components/useNativePlayerMotions.ts', {
      react: {
        useState: (initial) => {
          const index = stateIndex++;
          return [initial, (value) => { if (index === 0) changes.push(value); }];
        },
        useEffect: (effect) => { cleanup = effect(); },
      },
      '@/lib/dmoBundledMotion.mjs': { decodeBundledMotion: (buffer) => ({ selected: new TextDecoder().decode(buffer) }) },
      '@/lib/nativeMotionCatalog': { NATIVE_MOTION_CATALOG_SHA256: 'catalog-hash' },
      '@/lib/nativeMotionCatalogData': catalogData,
      '@/lib/dmoCharacterAppearance.mjs': characterGrunts,
    });
    hook.useNativePlayerMotions({
      playerNames: ['Djokovic', 'Federer'], submissionId: '17', overridePlayerOrder: [1, 0],
    });
    for (let attempt = 0; attempt < 20 && changes.length < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const sources = changes.at(-1);
    assert.equal(sources[0].clips.forehand.clip.selected, 'second-player');
    assert.equal(sources[1].clips.forehand.clip.selected, 'first-player');
    assert.equal(sources[1].clips['slice-backhand'].clip.selected, 'first-player');
    assert.equal(sources[0].clips['slice-backhand'], undefined);
    assert.equal(requests.some((url) => url.includes('a3_b3.wtm')), false);
    assert.equal(requests.filter((url) => url.endsWith('.wtm')).length, 3);
    assert.match(requests[0], /submissionId=17/);
  } finally {
    cleanup?.();
    globalThis.fetch = oldFetch;
  }
});

test('the existing slice path uses assigned slice timing, never the ordinary drive or smash', () => {
  const { bundledCaptureTiming } = load('components/DmoBundledGroundstroke.ts', {
    '@/lib/dmoBundledMotion.mjs': {},
  });
  const binding = (contactTime) => ({ clip: { duration: 2 }, contactTime });
  const source = { clips: {
    forehand: binding(0.25), backhand: binding(0.5),
    'slice-forehand': binding(0.75), 'slice-backhand': binding(1),
    smash: binding(1.25),
  } };
  assert.equal(bundledCaptureTiming(source, { stroke: 'backhand', slice: true }).leadFrames, 60);
  assert.equal(bundledCaptureTiming(source, { stroke: 'forehand', slice: true }).leadFrames, 45);
  assert.equal(bundledCaptureTiming(source, { stroke: 'backhand' }).leadFrames, 30);
  assert.equal(bundledCaptureTiming(source, { stroke: 'forehand' }).leadFrames, 15);
  assert.equal(bundledCaptureTiming(source, { stroke: 'forehand', smash: true }).leadFrames, 75);
  assert.equal(bundledCaptureTiming({ clips: {} }, { stroke: 'backhand', slice: true }), undefined);
});
