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
  new Function('require', 'module', 'exports', code)((name) => (
    name in mocks ? mocks[name] : require(name)
  ), module, module.exports);
  return module.exports;
}

const groups = [
  { id: 'male-aliassime', label: 'Male · Aliassime' },
  { id: 'female-keys', label: 'Female · Keys' },
];
const profiles = [
  {
    key: 'felix auger aliassime',
    name: 'Felix Auger-Aliassime',
    gender: 'male',
    heightCm: 193,
    weightKg: 88,
    gruntGroup: 'male-aliassime',
  },
];
const appearance = {
  dmoCharacterNameKey: (name) => String(name ?? '').toLowerCase().replaceAll('-', ' '),
  getDmoCharacterAppearance: (name) => profiles.find(
    (profile) => profile.key === String(name ?? '').toLowerCase().replaceAll('-', ' '),
  ) ?? null,
  getDmoCharacterGruntGroups: () => groups,
  getDmoCharacterProfiles: () => profiles,
  isDmoCharacterGruntGroup: (group) => groups.some((candidate) => candidate.id === group),
};

function setup(options = {}) {
  const calls = [];
  const route = load('app/api/admin/native-motion/grunt-profiles/route.ts', {
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
    '@/lib/auth': { getSession: async () => options.user === undefined ? { isAdmin: true } : options.user },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => options.sameSite !== false },
    '@/lib/dmoCharacterAppearance.mjs': appearance,
    '@/lib/db': {
      sql: async (strings, ...values) => {
        calls.push({ text: strings.join('?'), values });
        return options.rows ?? [];
      },
    },
  });
  return { route, calls };
}

const request = (body) => new Request('https://forum.test/api/admin/native-motion/grunt-profiles', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('admin profile list combines imported defaults with saved choices', async () => {
  const { route } = setup({
    rows: [{ profile_key: 'felix auger aliassime', character_name: 'Felix Auger-Aliassime', grunt_group: null }],
  });
  const response = await route.GET();
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.groups, groups);
  assert.deepEqual(payload.profiles[0], {
    ...profiles[0],
    defaultGroup: 'male-aliassime',
    assignedGroup: null,
    isOverridden: true,
  });
});

test('an admin can restore imported defaults, assign a bank, or explicitly mute a profile', async () => {
  const reset = setup();
  assert.equal((await reset.route.PUT(request({
    characterName: 'Felix Auger-Aliassime',
    gruntGroup: '__default__',
  }))).status, 200);
  assert.match(reset.calls[0].text, /DELETE FROM dmo_character_grunt_profiles/);

  const assigned = setup();
  assert.equal((await assigned.route.PUT(request({
    characterName: 'Felix Auger-Aliassime',
    gruntGroup: 'female-keys',
  }))).status, 200);
  assert.match(assigned.calls[0].text, /ON CONFLICT \(profile_key\) DO UPDATE/);
  assert.deepEqual(assigned.calls[0].values, [
    'felix auger aliassime',
    'Felix Auger-Aliassime',
    'female-keys',
  ]);

  const muted = setup();
  const response = await muted.route.PUT(request({
    characterName: 'Felix Auger-Aliassime',
    gruntGroup: null,
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(muted.calls[0].values, [
    'felix auger aliassime',
    'Felix Auger-Aliassime',
    null,
  ]);
});

test('non-admin and invalid grunt profile changes are rejected without writes', async () => {
  for (const options of [
    { user: null },
    { user: { isAdmin: false } },
    { sameSite: false },
    { body: { characterName: 'Unknown Player', gruntGroup: 'male-aliassime' } },
    { body: { characterName: 'Felix Auger-Aliassime', gruntGroup: 'not-a-bank' } },
  ]) {
    const { route, calls } = setup(options);
    const response = await route.PUT(request(options.body ?? {
      characterName: 'Felix Auger-Aliassime',
      gruntGroup: 'male-aliassime',
    }));
    assert.ok([400, 403].includes(response.status));
    assert.equal(calls.length, 0);
  }
});
