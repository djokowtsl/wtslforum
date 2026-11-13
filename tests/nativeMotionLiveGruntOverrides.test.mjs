import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const catalogData = (() => {
  const { code } = transformSync(readFileSync(new URL('../lib/nativeMotionCatalogData.ts', import.meta.url), 'utf8'), {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => require(name), module, module.exports);
  return module.exports;
})();
function load(path, mocks = {}) {
  const { code } = transformSync(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => (
    name in mocks ? mocks[name] : require(name)
  ), module, module.exports);
  return module.exports;
}

const broadcastId = 'd2917824-65d4-4c7f-976c-ac30004eb253';
const appearance = {
  isDmoCharacterGruntGroup: (group) => group === 'male-aliassime',
};

function setup(options = {}) {
  const reads = [];
  const writes = [];
  const route = load('app/api/native-motion/live-overrides/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/auth': { getSession: async () => options.user === undefined
      ? { discordId: 'stream-owner', isAdmin: false }
      : options.user },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => options.sameSite !== false },
    '@/lib/dmoCharacterAppearance.mjs': appearance,
    '@/lib/nativeMotionCatalogData': catalogData,
    '@/lib/nativeMotionServer': {
      fetchNativeMotionCatalog: async () => ({ clips: options.clips ?? [] }),
    },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        const text = strings.join('?');
        reads.push({ text, values });
        if (text.includes('SELECT owner_discord_id')) {
          return options.broadcast === false ? [] : [{
            owner_discord_id: 'stream-owner',
            payload: { hasDmo: true },
          }];
        }
        if (text.includes('FROM dmo_character_grunt_match_overrides')) {
          return [{ player_index: 0, grunt_group: null }];
        }
        if (text.includes('FROM dmo_native_motion_player_overrides')) {
          return [{ player_index: 1, clips: { serve: { clipId: 'a1_b1', sourceHandedness: 'right' } } }];
        }
        return [];
      },
      transaction: async (build) => {
        build((strings, ...values) => {
          writes.push({ text: strings.join('?'), values });
          return {};
        });
      },
    },
  });
  return { route, reads, writes };
}

function getRequest() {
  return new Request(`https://forum.test/api/native-motion/live-overrides?broadcastId=${broadcastId}`);
}

function putRequest(body) {
  return new Request('https://forum.test/api/native-motion/live-overrides', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('stream owners can save and clear slice choices using the existing live control endpoint', async () => {
  const slice = { clipId: 'a5_b5', sourceHandedness: 'right' };
  const { route, writes } = setup({ clips: [{
    id: 'a5_b5', sourceBundle: 'barty-bh-slice', label: 'Barty-BH-Slice',
    duration: 1, events: { kind: 'strike', contactTime: 0.5 },
  }] });
  const response = await route.PUT(putRequest({
    broadcastId, playerClips: [{ 'slice-backhand': slice }, {}],
  }));
  assert.equal(response.status, 200);
  assert.ok(writes.some((write) => write.values.includes(JSON.stringify({ 'slice-backhand': slice }))));
  const cleared = await route.PUT(putRequest({ broadcastId, playerClips: [{}, {}] }));
  assert.equal(cleared.status, 200);
  const invalid = await route.PUT(putRequest({
    broadcastId, playerClips: [{ 'slice-forehand': slice }, {}],
  }));
  assert.equal(invalid.status, 400);
});

test('stream owners can read per-player grunt choices, including explicit silence', async () => {
  const { route } = setup();
  const response = await route.GET(getRequest());
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.playerGruntOverrides, [{ gruntGroup: null }, null]);
  assert.deepEqual(payload.playerClips, [{}, { serve: { clipId: 'a1_b1', sourceHandedness: 'right' } }]);
});

test('stream owners can save per-player banks and no-grunt choices', async () => {
  const { route, writes } = setup();
  const response = await route.PUT(putRequest({
    broadcastId,
    playerClips: [{}, {}],
    playerGruntOverrides: [{ gruntGroup: 'male-aliassime' }, { gruntGroup: null }],
  }));
  assert.equal(response.status, 200);
  assert.equal(writes.length, 4);
  assert.match(writes[1].text, /DELETE FROM dmo_character_grunt_match_overrides/);
  assert.deepEqual(writes[2].values, [broadcastId, 0, 'male-aliassime']);
  assert.deepEqual(writes[3].values, [broadcastId, 1, null]);
});

test('non-owners, cross-site requests, and unavailable broadcasts cannot edit grunts', async () => {
  for (const options of [
    { user: { discordId: 'other-user', isAdmin: false } },
    { sameSite: false },
    { broadcast: false },
  ]) {
    const { route, writes } = setup(options);
    const response = await route.PUT(putRequest({
      broadcastId,
      playerClips: [{}, {}],
      playerGruntOverrides: [{ gruntGroup: 'male-aliassime' }, null],
    }));
    assert.ok([403, 404].includes(response.status));
    assert.equal(writes.length, 0);
  }
});
