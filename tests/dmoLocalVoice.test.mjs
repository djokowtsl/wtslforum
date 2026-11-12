import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../lib/dmoLocalVoice.mjs', import.meta.url), 'utf8');
let moduleNumber = 0;

async function withLoader({ gpu, createModel, userAgent = '', serverModel = null }, check) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousFactory = globalThis.__testDmoKokoro;
  const calls = [];
  const progress = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu, userAgent } });
  globalThis.__testDmoSpeech = {
    createDmoServerVoiceModel: () => {
      if (!serverModel) throw new Error('server voice unavailable');
      return serverModel;
    },
  };
  globalThis.__testDmoKokoro = {
    async from_pretrained(id, options) {
      calls.push({ id, ...options });
      return createModel(options);
    },
  };
  try {
    // Exercise the real loader without fetching weights or initializing hardware.
    const injected = source.replaceAll(
      "import('kokoro-js')",
      'Promise.resolve({ KokoroTTS: globalThis.__testDmoKokoro })',
    ).replaceAll(
      "import('./dmoCommentarySpeech.mjs')",
      'Promise.resolve(globalThis.__testDmoSpeech)',
    ) + `\n// isolated loader ${moduleNumber++}`;
    const module = await import(`data:text/javascript;base64,${Buffer.from(injected).toString('base64')}`);
    await check(module, calls, progress);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else delete globalThis.navigator;
    if (previousFactory === undefined) delete globalThis.__testDmoKokoro;
    else globalThis.__testDmoKokoro = previousFactory;
  }
}

test('Kokoro runs the compact q8 model on WASM even when WebGPU is available', async () => {
  const model = {};
  await withLoader({
    gpu: { requestAdapter: async () => ({}) },
    createModel: async () => model,
  }, async (loader, calls, progress) => {
    assert.equal(await loader.loadDmoLocalVoiceModel((event) => progress.push(event)), model);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].device, 'wasm');
    assert.equal(calls[0].dtype, 'q8');
    assert.ok(!progress.some((event) => event.backend === 'webgpu'));
    assert.equal(await loader.loadDmoLocalVoiceModel(), model, 'the model is shared across callers');
    assert.equal(calls.length, 1);
  });
});

test('the loader proves the voice can speak with a short warm-up line', async () => {
  const spoken = [];
  const model = { async generate(text, options) { spoken.push({ text, ...options }); return {}; } };
  await withLoader({ createModel: async () => model }, async (loader, calls, progress) => {
    assert.equal(await loader.loadDmoLocalVoiceModel((event) => progress.push(event)), model);
    assert.deepEqual(spoken, [{ text: loader.DMO_VOICE_WARMUP_TEXT, voice: 'af_heart' }]);
    assert.ok(progress.some((event) => event.status === 'warmup'));
  });
});

test('a voice that cannot speak fails the load and can be retried', async () => {
  let attempts = 0;
  await withLoader({
    createModel: async () => ({
      async generate() {
        if (++attempts === 1) throw new Error('WASM memory allocation failed');
        return {};
      },
    }),
  }, async (loader, calls) => {
    await assert.rejects(loader.loadDmoLocalVoiceModel(), /WASM memory allocation failed/);
    await loader.loadDmoLocalVoiceModel();
    assert.equal(calls.length, 2);
  });
});

test('browsers without a usable GPU adapter use local WASM directly', async () => {
  await withLoader({
    gpu: { requestAdapter: async () => null },
    createModel: async () => ({}),
  }, async (loader, calls) => {
    await loader.loadDmoLocalVoiceModel();
    assert.deepEqual(calls.map((call) => call.device), ['wasm']);
  });
});

test('a failed local model load can be retried', async () => {
  let attempts = 0;
  await withLoader({
    createModel: async () => {
      if (++attempts === 1) throw new Error('offline');
      return {};
    },
  }, async (loader, calls) => {
    await assert.rejects(loader.loadDmoLocalVoiceModel(), /offline/);
    await loader.loadDmoLocalVoiceModel();
    assert.equal(calls.length, 2);
  });
});

test('phones use the server voice and never load Kokoro in the tab', async () => {
  const spoken = [];
  const serverModel = { dmoVoiceSource: 'server', async generate(text) { spoken.push(text); return {}; } };
  await withLoader({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)',
    createModel: async () => { throw new Error('must not load locally'); },
    serverModel,
  }, async (loader, calls, progress) => {
    assert.equal(await loader.loadDmoLocalVoiceModel((event) => progress.push(event)), serverModel);
    assert.equal(calls.length, 0);
    assert.deepEqual(spoken, [loader.DMO_VOICE_WARMUP_TEXT]);
    assert.ok(progress.some((event) => event.backend === 'server'));
  });
});

test('a desktop that cannot run Kokoro locally falls back to the server voice', async () => {
  const serverModel = { dmoVoiceSource: 'server', async generate() { return {}; } };
  await withLoader({
    createModel: async () => { throw new Error('WASM unavailable'); },
    serverModel,
  }, async (loader, calls, progress) => {
    assert.equal(await loader.loadDmoLocalVoiceModel((event) => progress.push(event)), serverModel);
    assert.ok(progress.some((event) => event.status === 'backend-fallback'));
  });
});
