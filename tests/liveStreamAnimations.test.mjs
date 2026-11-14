import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
function load(path, mocks = {}) {
  const { code } = transformSync(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    jsc: { parser: { syntax: 'typescript', tsx: path.endsWith('.tsx') }, target: 'es2022',
      transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => (name in mocks ? mocks[name] : require(name)), module, module.exports);
  return module.exports;
}
const catalogData = load('lib/nativeMotionCatalogData.ts');
const STREAM = 'd2917824-65d4-4c7f-976c-ac30004eb253';
const pick = { clipId: 'a1_b1', sourceHandedness: 'right' };
const serve = { clipId: 'a2_b2', sourceHandedness: 'left' };
function setup({
  user = { discordId: 'streamer', isAdmin: false }, owner = 'streamer', live = true,
  saved = [], sameSite = true, payload = { hasDmo: true, playerCharacters: [null, null] },
} = {}) {
  const reads = [];
  const writes = [];
  const route = load('app/api/live-dmo/[id]/animations/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/auth': { getSession: async () => user },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => sameSite },
    '@/lib/nativeMotionCatalogData': catalogData,
    '@/lib/nativeMotionServer': { fetchNativeMotionCatalog: async () => ({ clips: [
      { id: 'a1_b1', duration: 1, events: { kind: 'strike', contactTime: 0.5 } },
      { id: 'a2_b2', duration: 1, events: { kind: 'serve', contactTime: 0.5 } },
    ] }) },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        const text = strings.join('?');
        reads.push({ text, values });
        if (text.includes('FROM dmo_live_broadcasts')) return live ? [{ owner_discord_id: owner, payload }] : [];
        if (text.includes('FROM dmo_native_motion_player_overrides')) return saved;
        return [];
      },
      transaction: async (build) => {
        build((strings, ...values) => { writes.push({ text: strings.join('?'), values }); return {}; });
      },
    },
  });
  return { route, reads, writes };
}
const context = { params: Promise.resolve({ id: STREAM }) };
const put = (body) => new Request(`https://forum.test/api/live-dmo/${STREAM}/animations`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
test('the streamer saves one no-character player and leaves the other alone', async () => {
  const { route, writes } = setup();
  const response = await route.PUT(put({ playerClips: [{ forehand: pick, serve }, null] }), context);
  assert.equal(response.status, 200);
  assert.equal(writes.length, 2);
  assert.match(writes[0].text, /DELETE[\s\S]*player_index=/);
  assert.deepEqual(writes[0].values, [STREAM, 0]);
  assert.deepEqual(JSON.parse(writes[1].values[2]), { forehand: pick, serve });
});
test('an empty choice clears that player back to standard motion', async () => {
  const { route, writes } = setup();
  assert.equal((await route.PUT(put({ playerClips: [null, {}] }), context)).status, 200);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].values, [STREAM, 1]);
});
test('manual and automatic streams have the same ownership rules', async () => {
  for (const mode of ['auto', 'manual']) {
    const { route, reads } = setup({ payload: { hasDmo: true, broadcastMode: mode } });
    assert.equal((await route.PUT(put({ playerClips: [{ forehand: pick }, null] }), context)).status, 200);
    assert.doesNotMatch(reads[0].text, /mode/);
  }
});
test('other members cannot read or change the stream; admins can', async () => {
  const other = setup({ user: { discordId: 'someone-else', isAdmin: false } });
  assert.equal((await other.route.PUT(put({ playerClips: [{ forehand: pick }, null] }), context)).status, 403);
  assert.equal((await other.route.GET(new Request('https://forum.test'), context)).status, 403);
  assert.equal(other.writes.length, 0);
  const admin = setup({ user: { discordId: 'admin', isAdmin: true } });
  assert.equal((await admin.route.PUT(put({ playerClips: [{ forehand: pick }, null] }), context)).status, 200);
});
test('guests, ended streams, video-only streams and cross-site saves are refused', async () => {
  for (const [options, status] of [[{ user: null }, 401], [{ live: false }, 404],
    [{ sameSite: false }, 403], [{ payload: { hasDmo: false } }, 404]]) {
    const { route, writes } = setup(options);
    assert.equal((await route.PUT(put({ playerClips: [{}, null] }), context)).status, status);
    assert.equal(writes.length, 0);
  }
  assert.equal((await setup().route.GET(new Request('https://forum.test'),
    { params: Promise.resolve({ id: 'not-a-uuid' }) })).status, 404);
});
test('roster players are protected on the server, including clears and admin requests', async () => {
  for (const payload of [
    { hasDmo: true, playerCharacters: ['Federer', null] },
    { hasDmo: true, character: 'Federer', opponentCharacter: null },
  ]) {
    for (const clips of [{}, { forehand: pick }]) {
      const { route, writes } = setup({ payload, user: { discordId: 'admin', isAdmin: true } });
      assert.equal((await route.PUT(put({ playerClips: [clips, null] }), context)).status, 409);
      assert.equal(writes.length, 0);
    }
    const { route, writes } = setup({ payload });
    assert.equal((await route.PUT(put({ playerClips: [null, { forehand: pick }] }), context)).status, 200);
    assert.ok(writes.every((write) => write.values[1] === 1));
  }
});
test('restoring device defaults cannot overwrite an existing admin assignment', async () => {
  const { route, writes } = setup();
  assert.equal((await route.PUT(put({ playerClips: [{ forehand: pick }, null], onlyIfEmpty: true }), context)).status, 200);
  assert.equal(writes.length, 1);
  assert.doesNotMatch(writes[0].text, /DELETE/);
  assert.match(writes[0].text, /ON CONFLICT[\s\S]*DO NOTHING/);
});
test('incompatible clips, missing handedness, invalid JSON and oversized bodies are rejected', async () => {
  const wrong = setup();
  assert.equal((await wrong.route.PUT(put({ playerClips: [{ serve: pick }, null] }), context)).status, 400);
  assert.equal(wrong.writes.length, 0);
  assert.equal((await setup().route.PUT(put({ playerClips: [{ forehand: { clipId: 'a1_b1' } }, null] }), context)).status, 400);
  for (const [body, expected] of [['{', 400], [' '.repeat(8_001), 413]]) {
    assert.equal((await setup().route.PUT(new Request('https://forum.test', { method: 'PUT', body }), context)).status, expected);
  }
});
test('the streamer can read back choices and its own owner-scoped storage identity', async () => {
  const { route } = setup({ saved: [{ player_index: 1, clips: { forehand: pick } }] });
  const response = await route.GET(new Request('https://forum.test'), context);
  assert.deepEqual(await response.json(), { playerClips: [{}, { forehand: pick }], ownerDiscordId: 'streamer' });
});
test('the host only offers editable slots for no-character players', () => {
  const host = readFileSync(new URL('../components/DmoLiveHost.tsx', import.meta.url), 'utf8');
  assert.match(host, /<LiveStreamAnimationPicker[\s\S]*open=\{\[!savedBroadcastCharacter\.trim\(\), !savedBroadcastOpponentCharacter\.trim\(\)\]\}/);
  const picker = readFileSync(new URL('../components/LiveStreamAnimationPicker.tsx', import.meta.url), 'utf8');
  assert.match(picker, /open\[index\] \? complete\(drafts\[index\]\) : null/);
});

async function restorePicker({ saved = [{}, {}], open = [true, true], fail = false } = {}) {
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  const requests = [];
  const effects = [];
  const states = [];
  let stateIndex = 0;
  let reads = 0;
  const storage = new Map([
    ['wtsl-live-animations:streamer:0', JSON.stringify({ forehand: pick })],
    ['wtsl-live-animations:someone-else:1', JSON.stringify({ serve })],
  ]);
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null } };
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (String(url).endsWith('/catalog.json')) return Response.json({ clips: [] });
    if (init?.method === 'PUT') return Response.json(
      fail ? { error: 'Restore failed' } : { ok: true }, { status: fail ? 503 : 200 });
    reads++;
    return Response.json({
      ownerDiscordId: 'streamer',
      playerClips: reads > 1 ? [{ serve }, saved[1]] : saved,
    });
  };
  const cleanups = [];
  try {
    const component = load('components/LiveStreamAnimationPicker.tsx', {
      react: {
        useState: (initial) => { const index = stateIndex++; states[index] = []; return [initial, (v) => states[index].push(v)]; },
        useEffect: (effect) => effects.push(effect),
      },
      '@/lib/nativeMotionCatalogData': catalogData,
      '@/lib/nativeMotionCatalog': { NATIVE_MOTION_CATALOG_SHA256: 'test' },
      './SearchableClipSelect': { default: () => null },
      './DmoLiveHost.module.css': {},
    }).default;
    component({ broadcastId: STREAM, open, labels: ['Your player', 'Opponent'] });
    effects.forEach((effect) => cleanups.push(effect()));
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
    return { requests, states };
  } finally {
    cleanups.forEach((cleanup) => cleanup?.());
    globalThis.fetch = oldFetch;
    globalThis.window = oldWindow;
  }
}
test('remembered choices restore for the same streamer and read back concurrent admin choices', async () => {
  const { requests, states } = await restorePicker({ saved: [{}, { forehand: pick }] });
  const writes = requests.filter((request) => request.init?.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].init.body), { playerClips: [{ forehand: pick }, null], onlyIfEmpty: true });
  assert.deepEqual(states[1].at(-1), [{ serve }, { forehand: pick }]);
});
test('existing choices are not restored over and roster slots are left alone', async () => {
  for (const options of [{ saved: [{ forehand: pick }, {}] }, { open: [false, true] }]) {
    const { requests } = await restorePicker(options);
    assert.equal(requests.filter((request) => request.init?.method === 'PUT').length, 0);
  }
});
test('a failed automatic restore is visible and leaves manual correction available', async () => {
  const { states } = await restorePicker({ fail: true });
  assert.equal(states[5].at(-1), 'Restore failed');
  assert.equal(states[3].at(-1), STREAM);
});
