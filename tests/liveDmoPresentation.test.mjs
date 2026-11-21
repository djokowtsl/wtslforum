import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const ID = 'd2917824-65d4-4c7f-976c-ac30004eb253';

function load(path, mocks = {}) {
  const { code } = transformSync(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    jsc: { parser: { syntax: 'typescript', tsx: path.endsWith('.tsx') }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (name) => (name in mocks ? mocks[name] : require(name)),
    module,
    module.exports,
  );
  return module.exports;
}

function setup({
  user = { discordId: 'streamer', isAdmin: false },
  owner = 'streamer',
  live = true,
  hasDmo = true,
  sameSite = true,
} = {}) {
  const queries = [];
  const route = load('app/api/live-dmo/[id]/presentation/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { getSession: async () => user },
    '@/lib/liveRequestSecurity': { isSameSiteMutation: () => sameSite },
    '@/lib/db': {
      sql: async (strings, ...values) => {
        const text = strings.join('?');
        queries.push({ text, values });
        if (text.includes('SELECT owner_discord_id')) {
          return live ? [{ owner_discord_id: owner, payload: { hasDmo } }] : [];
        }
        return live ? [{ id: ID }] : [];
      },
    },
  });
  return { route, queries };
}

const context = { params: Promise.resolve({ id: ID }) };
const request = (body, method = 'PATCH') => new Request(`https://forum.test/api/live-dmo/${ID}/presentation`, {
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const settings = {
  handedness: ['left', 'right'],
  strokeStyles: [
    { forehand: 'one', backhand: 'two' },
    { forehand: 'two', backhand: 'one' },
  ],
};

test('the owner can save handedness and grip overrides onto the live snapshot', async () => {
  const { route, queries } = setup();
  const response = await route.PATCH(request(settings), context);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const update = queries[1];
  assert.match(update.text, /presentationOverrides/);
  assert.match(update.text, /'snapshot'/);
  assert.deepEqual(update.values, [JSON.stringify(settings), JSON.stringify(settings), ID]);
  assert.doesNotMatch(update.text, /updated_at/);
});

test('admins can edit another owner’s live DMO stream', async () => {
  const { route } = setup({ user: { discordId: 'admin', isAdmin: true }, owner: 'someone-else' });
  assert.equal((await route.PATCH(request({ handedness: ['right', 'left'] }), context)).status, 200);
});

test('guests, other members, ended broadcasts, and video-only streams cannot edit settings', async () => {
  const cases = [
    [{ user: null }, 401],
    [{ user: { discordId: 'other', isAdmin: false } }, 403],
    [{ live: false }, 404],
    [{ hasDmo: false }, 404],
    [{ sameSite: false }, 403],
  ];
  for (const [options, status] of cases) {
    const { route, queries } = setup(options);
    assert.equal((await route.PATCH(request(settings), context)).status, status);
    assert.equal(queries.filter((query) => query.text.startsWith('UPDATE')).length, 0);
  }
});

test('invalid or oversized presentation choices are rejected without updating the broadcast', async () => {
  const invalid = setup();
  assert.equal((await invalid.route.PATCH(request({ handedness: ['left', 'ambidextrous'] }), context)).status, 400);
  assert.equal(invalid.queries.length, 0);

  const oversized = setup();
  const response = await oversized.route.PATCH(new Request(`https://forum.test/api/live-dmo/${ID}/presentation`, {
    method: 'PATCH',
    body: JSON.stringify({ extra: 'x'.repeat(5_000) }),
  }), context);
  assert.equal(response.status, 413);
  assert.equal(oversized.queries.length, 0);
});

test('broadcaster snapshots keep admin presentation overrides applied', () => {
  const route = readFileSync(new URL('../app/api/live-dmo/[id]/route.ts', import.meta.url), 'utf8');
  assert.match(route, /request_data\.snapshot\s*\|\|\s*COALESCE\(live\.payload->'presentationOverrides'/);
  assert.match(route, /live\.payload->'snapshot'\s*=\s*\(\s*request_data\.snapshot\s*\|\|\s*COALESCE\(live\.payload->'presentationOverrides'/);
});
