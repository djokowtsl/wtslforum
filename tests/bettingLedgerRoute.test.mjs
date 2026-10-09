import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const source = await readFile(new URL('../app/api/betting/ledger/route.ts', import.meta.url), 'utf8');
let session;
let ledgerPayload;
let ledgerCalls;
const routeModule = new Module(import.meta.url);
routeModule.require = (name) => {
  if (name === 'next/server') return { NextResponse: { json: (body, init) => Response.json(body, init) } };
  if (name === '@/lib/auth') return { getSession: async () => session };
  if (name === '@/lib/wtsl-core') return { wtslCore: { bets: async (id) => {
    ledgerCalls.push(id);
    if (ledgerPayload instanceof Error) throw ledgerPayload;
    return ledgerPayload;
  } } };
  throw new Error(`Unexpected route dependency: ${name}`);
};
routeModule._compile(transformSync(source, {
  filename: 'ledger-route.ts',
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
  module: { type: 'commonjs' },
}).code, 'ledger-route.js');
const { GET, maxDuration } = routeModule.exports;

test.beforeEach(() => {
  session = { discordId: 'signed-in-user' };
  ledgerPayload = [];
  ledgerCalls = [];
});

test('the ledger route has headroom beyond the bounded Core request', () => {
  assert.equal(maxDuration, 30);
});

test('private ledgers still require a signed-in session', async () => {
  session = null;
  const response = await GET();
  assert.equal(response.status, 401);
  assert.deepEqual(ledgerCalls, []);
});

test('the signed-in identity is bound server-side and the response is not cached', async () => {
  ledgerPayload = [{ bet_id: 7, status: 'open' }];
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { bets: ledgerPayload });
  assert.deepEqual(ledgerCalls, ['signed-in-user']);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('a confirmed empty ledger is distinguishable from an invalid feed', async (t) => {
  const empty = await GET();
  assert.deepEqual(await empty.json(), { bets: [] });
  t.mock.method(console, 'warn', () => {});
  for (const payload of [null, {}, { error: 'unavailable' }]) {
    ledgerPayload = payload;
    const response = await GET();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'betting_ledger_unavailable' });
  }
});

test('Core request failures remain explicit rather than replacing ticket history', async (t) => {
  t.mock.method(console, 'warn', () => {});
  ledgerPayload = new Error('temporary database error');
  const response = await GET();
  assert.equal(response.status, 503);
  assert.match(response.headers.get('cache-control'), /no-store/);
});
