import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const source = await readFile(new URL('../lib/liveCourtUmpire.ts', import.meta.url), 'utf8');
const { code } = transformSync(source, {
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' },
});
const module = { exports: {} };
new Function('module', 'exports', 'require', code)(module, module.exports, () => ({
  cancelXktUmpireCalls() {}, playXktUmpireCall: async () => true,
}));
const api = module.exports;
const end = frame => ({ frame, kind: 'point-end', text: '' });

test('a late live point-end is consumed once after the playhead passed it', () => {
  const cursor = api.createLiveUmpireEventCursor();
  assert.deepEqual(api.consumeLiveUmpireCallEvents(cursor, [], 100, 101, true), []);
  assert.deepEqual(api.consumeLiveUmpireCallEvents(cursor, [end(120)], 145, 146, true), [end(120)]);
  assert.deepEqual(api.consumeLiveUmpireCallEvents(cursor, [end(120)], 146, 147, true), []);
});

test('joining, muting, rewinding and re-enabling never speak a historical backlog', () => {
  const cursor = api.createLiveUmpireEventCursor();
  assert.deepEqual(api.consumeLiveUmpireCallEvents(cursor, [end(10), end(20)], null, 30, true), []);
  assert.deepEqual(api.consumeLiveUmpireCallEvents(cursor, [end(25)], 30, 31, true), []);
  assert.deepEqual(api.consumeLiveUmpireCallEvents(cursor, [end(35)], 34, 36, true), [end(35)]);
  assert.deepEqual(api.consumeLiveUmpireCallEvents(cursor, [end(40)], 36, 50, false), []);
  assert.deepEqual(api.consumeLiveUmpireCallEvents(cursor, [end(40)], 50, 51, true), []);
  assert.deepEqual(api.consumeLiveUmpireCallEvents(cursor, [end(52)], 51, 53, true), [end(52)]);
  assert.deepEqual(api.consumeLiveUmpireCallEvents(cursor, [end(20)], 53, 20, true), []);
});

test('late live batches retain no more than the current and one preceding point', () => {
  const cursor = api.createLiveUmpireEventCursor();
  api.consumeLiveUmpireCallEvents(cursor, [], 100, 101, true);
  assert.deepEqual(api.consumeLiveUmpireCallEvents(
    cursor, [end(110), end(120), end(130)], 150, 151, true,
  ), [end(120), end(130)]);
  assert.deepEqual(api.consumeLiveUmpireCallEvents(cursor, [end(125)], 151, 152, true), []);
});

test('late line calls are discarded while immediate line calls remain eligible', () => {
  const cursor = api.createLiveUmpireEventCursor();
  const out = frame => ({ frame, kind: 'out', text: 'Out' });
  assert.deepEqual(api.consumeLiveUmpireCallEvents(
    cursor, [out(105), out(120)], 119, 121, true,
  ), [out(120)]);
});

test('browser suspension is observed and the listener is cleaned up', () => {
  const context = new EventTarget();
  context.state = 'running';
  let paused = 0;
  const dispose = api.watchUmpireAudioContext(context, () => paused++);
  assert.equal(paused, 0);
  context.state = 'suspended';
  context.dispatchEvent(new Event('statechange'));
  assert.equal(paused, 1);
  dispose();
  context.state = 'closed';
  context.dispatchEvent(new Event('statechange'));
  assert.equal(paused, 1);
});

test('both renderers consume late events and restore the enable control after browser suspension', async () => {
  for (const file of ['DmoLiveCourt.tsx', 'DmoLiveCourt3D.tsx']) {
    const renderer = await readFile(new URL(`../components/${file}`, import.meta.url), 'utf8');
    assert.match(renderer, /consumeLiveUmpireCallEvents\(/);
    assert.match(renderer, /watchUmpireAudioContext\(context/);
    assert.match(renderer, /umpireSpeechReadyRef\.current = false;\s*setUmpireSpeechReady\(false\)/);
    assert.match(renderer, /event\.kind === 'point-end' && event\.frame < earliestFrame/);
  }
  const fallback = await readFile(new URL('../components/DmoLiveCourt.tsx', import.meta.url), 'utf8');
  const speechLoop = fallback.slice(fallback.indexOf('const previousCallFrame ='), fallback.indexOf('const previousCallFrame =') + 4000);
  assert.doesNotMatch(speechLoop, /motionPreference\.matches/);
});
