import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchBetLedger } from '../lib/betting-ledger.ts';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('retries a transient feed response and returns the ledger', async () => {
  let calls = 0;
  let pauses = 0;
  const result = await fetchBetLedger(
    new AbortController().signal,
    async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ error: 'temporarily unavailable' }, 503)
        : jsonResponse({ bets: [{ bet_id: 'bet-1' }] });
    },
    async () => { pauses += 1; },
  );

  assert.deepEqual(result, { kind: 'ready', bets: [{ bet_id: 'bet-1' }] });
  assert.equal(calls, 2);
  assert.equal(pauses, 1);
});

test('retries a network error once', async () => {
  let calls = 0;
  const result = await fetchBetLedger(
    new AbortController().signal,
    async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return jsonResponse({ bets: [] });
    },
    async () => {},
  );

  assert.deepEqual(result, { kind: 'ready', bets: [] });
  assert.equal(calls, 2);
});

test('returns unavailable after both feed attempts fail', async () => {
  let calls = 0;
  const result = await fetchBetLedger(
    new AbortController().signal,
    async () => {
      calls += 1;
      return jsonResponse({ error: 'temporarily unavailable' }, 503);
    },
    async () => {},
  );

  assert.deepEqual(result, { kind: 'unavailable' });
  assert.equal(calls, 2);
});

test('does not retry an unauthorized account feed', async () => {
  let calls = 0;
  const result = await fetchBetLedger(
    new AbortController().signal,
    async () => {
      calls += 1;
      return jsonResponse({ error: 'unauthorized' }, 401);
    },
    async () => {},
  );

  assert.deepEqual(result, { kind: 'unauthorized' });
  assert.equal(calls, 1);
});
