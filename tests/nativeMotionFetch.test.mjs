import assert from 'node:assert/strict';
import test from 'node:test';

const { fetchNativeMotionAsset } = await import('../lib/nativeMotionFetch.ts');

test('native motion assets retry only while the API advertises a warm-up delay', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const delays = [];
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response(null, { status: 503, headers: { 'Retry-After': '3' } })
      : new Response('catalog', { status: 200 });
  };
  globalThis.setTimeout = (callback, delay, ...args) => {
    delays.push(delay);
    return originalSetTimeout(callback, 0, ...args);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  const response = await fetchNativeMotionAsset('/asset/catalog.json');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'catalog');
  assert.equal(calls, 2);
  assert.deepEqual(delays, [3000]);
});

test('native motion asset errors without Retry-After are not retried', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ error: 'unavailable' }, { status: 503 });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await fetchNativeMotionAsset('/asset/catalog.json');
  assert.equal(response.status, 503);
  assert.equal(calls, 1);
});
