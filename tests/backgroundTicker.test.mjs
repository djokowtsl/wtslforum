import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { startBackgroundTicker } from '../lib/backgroundTicker.mjs';

function fakeWorker() {
  const worker = { messages: [], terminated: false, onmessage: null, onerror: null };
  worker.postMessage = (value) => worker.messages.push(value);
  worker.terminate = () => { worker.terminated = true; };
  worker.tick = () => worker.onmessage?.({ data: 0 });
  return worker;
}
const timers = () => {
  const started = [];
  return {
    started,
    setInterval: (fn, ms) => { started.push({ fn, ms, cleared: false }); return started.length - 1; },
    clearInterval: (id) => { started[id].cleared = true; },
  };
};

test('ticks use a dedicated worker rather than a background page timer', () => {
  const worker = fakeWorker(); const clock = timers(); let ticks = 0;
  const stop = startBackgroundTicker(() => { ticks += 1; }, 1_200, { createWorker: () => worker, ...clock });
  assert.deepEqual(worker.messages, [1_200]);
  assert.equal(clock.started.length, 0);
  worker.tick(); worker.tick();
  assert.equal(ticks, 2);
  stop(); stop();
  assert.equal(worker.terminated, true);
  worker.tick();
  assert.equal(ticks, 2, 'nothing after stopping');
});
test('without workers it falls back to an ordinary timer', () => {
  const clock = timers(); let ticks = 0;
  const stop = startBackgroundTicker(() => { ticks += 1; }, 5_000, { createWorker: () => null, ...clock });
  assert.equal(clock.started[0].ms, 5_000);
  clock.started[0].fn();
  assert.equal(ticks, 1);
  stop();
  assert.equal(clock.started[0].cleared, true);
});
test('a worker that fails to run hands over to the ordinary timer', () => {
  const worker = fakeWorker(); const clock = timers(); let ticks = 0;
  const stop = startBackgroundTicker(() => { ticks += 1; }, 1_200, { createWorker: () => worker, ...clock });
  worker.onerror();
  assert.equal(worker.terminated, true);
  clock.started[0].fn();
  assert.equal(ticks, 1);
  stop();
  assert.equal(clock.started[0].cleared, true);
});
test('worker construction and initialization failures both fall back', () => {
  for (const initialize of [false, true]) {
    const clock = timers();
    const worker = fakeWorker();
    worker.postMessage = () => { throw new Error('blocked'); };
    const stop = startBackgroundTicker(() => {}, 1_200, {
      createWorker: () => { if (!initialize) throw new Error('blocked'); return worker; }, ...clock,
    });
    assert.equal(clock.started.length, 1);
    if (initialize) assert.equal(worker.terminated, true);
    stop();
  }
});
test('the worker repeats on the interval it is sent and stops on 0', async () => {
  const posted = [];
  const scope = { postMessage: (value) => posted.push(value), onmessage: null };
  const source = readFileSync(new URL('../lib/backgroundTickerWorker.mjs', import.meta.url), 'utf8');
  new Function('self', source)(scope);
  scope.onmessage({ data: 10 });
  await new Promise((resolve) => setTimeout(resolve, 65));
  scope.onmessage({ data: 0 });
  const count = posted.length;
  assert.ok(count >= 2, `ticked ${count} times`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(posted.length, count);
});
test('the live host uploads and discovers recordings using the worker ticker', () => {
  const host = readFileSync(new URL('../components/DmoLiveHost.tsx', import.meta.url), 'utf8');
  assert.match(host, /startBackgroundTicker\(\(\) => \{ void pollFolder\(\); \}, LIVE_DMO_UPDATE_INTERVAL_MS\)/);
  assert.match(host, /startBackgroundTicker\(\(\) => \{ void refreshDmoFiles\(\); \}, 5_000\)/);
  assert.doesNotMatch(host, /setInterval\(\(\) => \{ void pollFolder\(\); \}/);
});
