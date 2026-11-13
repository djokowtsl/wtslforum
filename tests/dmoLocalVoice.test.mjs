import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DMO_VOICE_WARMUP_TEXT,
  isMobileDmoVoiceDevice,
  loadDmoLocalVoiceModel,
  resetDmoLocalVoiceModel,
} from '../lib/dmoLocalVoice.mjs';
import { createDmoVoiceRouter, createDmoWorkerVoiceModel } from '../lib/dmoVoiceEngine.mjs';
import { createDmoKokoroWorkerHandler, DMO_KOKORO_MODEL_ID } from '../lib/dmoKokoroWorker.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const audio = (value = 0.1) => ({ audio: new Float32Array([value]), sampling_rate: 24_000 });
function deferred() {
  let resolve; let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function speaker(label, log = []) {
  return { label, log, async generate(text, options) { log.push({ label, text, ...options }); return audio(); } };
}

// ---- Device detection ----

test('phones and tablets are recognised for the server voice', () => {
  assert.equal(isMobileDmoVoiceDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)' }), true);
  assert.equal(isMobileDmoVoiceDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), true);
  assert.equal(isMobileDmoVoiceDevice({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), false);
});

// ---- Loader ----

test('phones use only the server voice and never start local Kokoro', async () => {
  resetDmoLocalVoiceModel();
  const server = speaker('server');
  let localStarts = 0;
  const voice = await loadDmoLocalVoiceModel(undefined, {
    serverOnly: true,
    createServer: () => server,
    createLocal: () => { localStarts += 1; return new Promise(() => {}); },
  });
  assert.equal(localStarts, 0);
  assert.deepEqual(server.log.map((entry) => entry.text), [DMO_VOICE_WARMUP_TEXT], 'proven before use');
  await voice.generate('Deuce.', { voice: 'am_michael' });
  assert.equal(voice.dmoVoiceSource, 'server');
  resetDmoLocalVoiceModel();
});

test('desktop commentary is ready as soon as the server voice answers, while local Kokoro loads', async () => {
  resetDmoLocalVoiceModel();
  const server = speaker('server');
  const local = deferred();
  const voice = await loadDmoLocalVoiceModel(undefined, {
    serverOnly: false, createServer: () => server, createLocal: () => local.promise,
  });
  await voice.generate('Break point, gifu.', { voice: 'af_heart' });
  assert.equal(server.log.at(-1).text, 'Break point, gifu.', 'the server speaks while the local model loads');
  const localModel = speaker('local');
  local.resolve(localModel);
  await tick();
  assert.equal(voice.dmoVoiceSource, 'local');
  await voice.generate('Set point, gifu.', { voice: 'af_heart' });
  assert.equal(localModel.log.at(-1).text, 'Set point, gifu.', 'local Kokoro takes over once ready');
  resetDmoLocalVoiceModel();
});

test('desktop commentary still starts on local Kokoro when the server voice is unavailable', async () => {
  resetDmoLocalVoiceModel();
  const localModel = speaker('local');
  const voice = await loadDmoLocalVoiceModel(undefined, {
    serverOnly: false,
    createServer: () => ({ async generate() { throw new Error('404'); } }),
    createLocal: async () => localModel,
  });
  await voice.generate('Deuce.', { voice: 'af_heart' });
  assert.equal(localModel.log.at(-1).text, 'Deuce.');
  resetDmoLocalVoiceModel();
});

test('if neither voice can speak, the local cause is reported and a retry starts afresh', async () => {
  resetDmoLocalVoiceModel();
  let attempts = 0;
  const options = {
    serverOnly: false,
    createServer: () => ({ async generate() { throw new Error('401'); } }),
    createLocal: async () => { attempts += 1; throw new Error('WASM memory allocation failed'); },
  };
  await assert.rejects(loadDmoLocalVoiceModel(undefined, options), /WASM memory allocation failed/);
  await assert.rejects(loadDmoLocalVoiceModel(undefined, options), /WASM memory/);
  assert.equal(attempts, 2);
  resetDmoLocalVoiceModel();
});

// ---- Router ----

test('the router caches each line, so a repeated or prefetched line is not generated twice', async () => {
  const server = speaker('server');
  const voice = createDmoVoiceRouter({ server });
  voice.prefetch('Game, gifu.', { voice: 'am_michael', speed: 1.03 });
  const played = await voice.generate('Game, gifu.', { voice: 'am_michael', speed: 1.03, priority: 'high' });
  assert.equal(server.log.length, 1);
  assert.equal(server.log[0].priority, 'low', 'prefetches ask for background priority');
  assert.equal(played.audio.length, 1);
  await voice.generate('Game, gifu.', { voice: 'af_heart', speed: 1.03 });
  assert.equal(server.log.length, 2, 'a different voice is a different recording');
});

test('failed lines are not cached and prefetch failures stay silent', async () => {
  let fail = true;
  const voice = createDmoVoiceRouter({
    server: { async generate() { if (fail) throw new Error('busy'); return audio(); } },
  });
  voice.prefetch('Deuce.', { voice: 'af_heart' });
  await tick();
  fail = false;
  assert.equal((await voice.generate('Deuce.', { voice: 'af_heart' })).audio.length, 1);
});

test('the cache is bounded', async () => {
  const server = speaker('server');
  const voice = createDmoVoiceRouter({ server, cacheEntries: 2 });
  for (const line of ['One.', 'Two.', 'Three.']) await voice.generate(line, { voice: 'af_heart' });
  await voice.generate('One.', { voice: 'af_heart' });
  assert.equal(server.log.length, 4, 'the oldest line was evicted');
});

test('a local failure falls back to the server, and a server failure waits for local', async () => {
  const server = speaker('server');
  const broken = { async generate() { throw new Error('worker stopped'); } };
  await createDmoVoiceRouter({ server, local: broken }).generate('A.', { voice: 'af_heart' });
  assert.equal(server.log.at(-1).text, 'A.');

  const local = deferred();
  const voice = createDmoVoiceRouter({ server: { async generate() { throw new Error('503'); } }, local: local.promise });
  const line = voice.generate('B.', { voice: 'af_heart' });
  const localModel = speaker('local');
  local.resolve(localModel);
  await line;
  assert.equal(localModel.log.at(-1).text, 'B.');
});

// ---- Worker client ----

function fakeWorker() {
  const listeners = { message: [], error: [] };
  const worker = {
    sent: [], terminated: false,
    postMessage(message) { worker.sent.push(message); },
    addEventListener(type, listener) { listeners[type].push(listener); },
    terminate() { worker.terminated = true; },
    emit(data) { for (const listener of listeners.message) listener({ data }); },
    crash(message) { for (const listener of listeners.error) listener({ message }); },
  };
  return worker;
}

test('the worker client loads in the background and returns generated audio', async () => {
  const worker = fakeWorker();
  const progress = [];
  const ready = createDmoWorkerVoiceModel({ createWorker: () => worker, onProgress: (event) => progress.push(event) });
  assert.deepEqual(worker.sent[0], { type: 'load' });
  worker.emit({ type: 'progress', progress: { status: 'progress', progress: 40 } });
  worker.emit({ type: 'ready' });
  const model = await ready;
  assert.equal(model.dmoVoiceSource, 'local');
  assert.equal(progress[0].progress, 40);
  const line = model.generate('Deuce.', { voice: 'am_michael', speed: 1.03 });
  const request = worker.sent.at(-1);
  assert.equal(request.type, 'generate');
  assert.equal(request.priority, 'high');
  worker.emit({ type: 'audio', id: request.id, audio: new Float32Array([0.2]), sampling_rate: 24_000 });
  assert.equal((await line).audio[0], new Float32Array([0.2])[0]);
});

test('a worker that fails to load or crashes rejects instead of hanging', async () => {
  const failing = fakeWorker();
  const load = createDmoWorkerVoiceModel({ createWorker: () => failing });
  failing.emit({ type: 'load-error', message: 'offline' });
  await assert.rejects(load, /offline/);
  assert.equal(failing.terminated, true);

  const crashing = fakeWorker();
  const ready = createDmoWorkerVoiceModel({ createWorker: () => crashing });
  crashing.emit({ type: 'ready' });
  const model = await ready;
  const line = model.generate('Deuce.');
  crashing.crash('out of memory');
  await assert.rejects(line, /out of memory/);
  await assert.rejects(model.generate('Again.'), /out of memory/);
});

test('browsers that cannot create the worker reject so the server voice is used', async () => {
  await assert.rejects(createDmoWorkerVoiceModel({ createWorker: () => { throw new Error('no module workers'); } }),
    /no module workers/);
});

// ---- Worker ----

function workerHarness({ generate } = {}) {
  const posted = [];
  const loads = [];
  const model = { async generate(text, options) { return generate ? generate(text, options) : audio(); } };
  const handle = createDmoKokoroWorkerHandler({
    post: (message, transfer) => posted.push({ message, transfer }),
    importKokoro: async () => ({ KokoroTTS: { async from_pretrained(id, options) { loads.push({ id, ...options }); return model; } } }),
  });
  return { posted, loads, handle };
}

test('the worker loads the compact q8 model on WASM, warms up, then reports ready', async () => {
  const spoken = [];
  const w = workerHarness({ generate: (text) => { spoken.push(text); return audio(); } });
  w.handle({ type: 'load' });
  await tick(); await tick();
  assert.equal(w.loads[0].id, DMO_KOKORO_MODEL_ID);
  assert.equal(w.loads[0].device, 'wasm');
  assert.equal(w.loads[0].dtype, 'q8');
  assert.deepEqual(spoken, ['Ready.']);
  assert.ok(w.posted.some(({ message }) => message.type === 'ready'));
});

test('the worker hands audio over without copying and puts urgent lines first', async () => {
  const order = [];
  const w = workerHarness({ generate: (text) => { order.push(text); return audio(); } });
  w.handle({ type: 'generate', id: 1, text: 'Prefetched one.', voice: 'af_heart', speed: 1, priority: 'low' });
  w.handle({ type: 'generate', id: 2, text: 'Prefetched two.', voice: 'af_heart', speed: 1, priority: 'low' });
  w.handle({ type: 'generate', id: 3, text: 'Needed now.', voice: 'af_heart', speed: 1, priority: 'high' });
  for (let step = 0; step < 8; step += 1) await tick();
  // The first low job was already being generated; the urgent one jumps the rest.
  assert.deepEqual(order.filter((text) => text !== 'Ready.'), ['Prefetched one.', 'Needed now.', 'Prefetched two.']);
  const delivered = w.posted.filter(({ message }) => message.type === 'audio');
  assert.equal(delivered.length, 3);
  assert.equal(delivered[0].transfer[0], delivered[0].message.audio.buffer);
});

test('a worker generation failure is reported for that line only', async () => {
  const w = workerHarness({ generate: (text) => { if (text === 'Bad.') throw new Error('phonemizer'); return audio(); } });
  w.handle({ type: 'generate', id: 1, text: 'Bad.', voice: 'af_heart', speed: 1, priority: 'high' });
  w.handle({ type: 'generate', id: 2, text: 'Good.', voice: 'af_heart', speed: 1, priority: 'high' });
  for (let step = 0; step < 8; step += 1) await tick();
  assert.deepEqual(w.posted.filter(({ message }) => message.id).map(({ message }) => [message.id, message.type]),
    [[1, 'error'], [2, 'audio']]);
});
