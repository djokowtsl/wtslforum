import assert from 'node:assert/strict';
import test from 'node:test';

process.env.WTSL_CORE_API_URL = 'https://core.example.test';
process.env.WTSL_CORE_API_KEY = 'test-only-key';

const { wtslCore, WTSL_CORE_PUBLIC_TIMEOUT_MS } = await import('../lib/wtsl-core.ts');

test('public results and fixture reads are bounded and remain uncached at the fetch layer', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    const payload = String(url).endsWith('/api/core/results')
      ? []
      : { open: [], recent_settled: [] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  assert.equal(WTSL_CORE_PUBLIC_TIMEOUT_MS, 3_000);
  assert.deepEqual(await wtslCore.results(), []);
  assert.deepEqual(await wtslCore.fixtures(), []);
  assert.deepEqual(await wtslCore.fixturesBoard(), { open: [], recent_settled: [] });

  assert.match(requests[0].url, /\/api\/core\/results$/);
  assert.match(requests[1].url, /\/api\/core\/betting\/fixtures$/);
  assert.match(requests[2].url, /\/api\/core\/betting\/fixtures$/);
  assert.equal(requests[1].init.method, 'POST');
  assert.equal(requests[2].init.method, 'POST');
  for (const request of requests) {
    assert.equal(request.init.cache, 'no-store');
    assert.ok(request.init.signal instanceof AbortSignal);
  }
});

test('non-public Core calls keep their existing uncached behavior without the public-feed timeout', async (t) => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true, mode: 'read_only' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  assert.deepEqual(await wtslCore.health(), { ok: true, mode: 'read_only' });
  assert.equal(request.init.cache, 'no-store');
  assert.equal(request.init.signal, undefined);
});

test('account reads stay uncached and have request timeouts', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    const payload = String(url).endsWith('/bets')
      ? []
      : { discord_user_id: '123', balance: 0 };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await wtslCore.balance('123');
  await wtslCore.bets('123');

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.init.cache, 'no-store');
    assert.ok(request.init.signal instanceof AbortSignal);
  }
});
