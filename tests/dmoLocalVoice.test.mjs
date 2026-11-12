import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../lib/dmoLocalVoice.mjs', import.meta.url), 'utf8');
let moduleNumber = 0;

async function withLoader({ gpu, createModel }, check) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousFactory = globalThis.__testDmoKokoro;
  const calls = [];
  const progress = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu } });
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

test('Kokoro tries GPU acceleration without increasing the compact model precision', async () => {
  const model = {};
  await withLoader({
    gpu: { requestAdapter: async () => ({}) },
    createModel: async () => model,
  }, async (loader, calls, progress) => {
    assert.equal(await loader.loadDmoLocalVoiceModel((event) => progress.push(event)), model);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].device, 'webgpu');
    assert.equal(calls[0].dtype, 'q8');
    assert.ok(progress.some((event) => event.backend === 'webgpu'));
    assert.equal(await loader.loadDmoLocalVoiceModel(), model, 'the model is shared across callers');
    assert.equal(calls.length, 1);
  });
});

test('unavailable GPU acceleration falls back only to the same local Kokoro model on WASM', async () => {
  const model = {};
  await withLoader({
    gpu: { requestAdapter: async () => ({}) },
    createModel: async ({ device }) => {
      if (device === 'webgpu') throw new Error('Unsupported quantized GPU operator');
      return model;
    },
  }, async (loader, calls, progress) => {
    assert.equal(await loader.loadDmoLocalVoiceModel((event) => progress.push(event)), model);
    assert.deepEqual(calls.map((call) => call.device), ['webgpu', 'wasm']);
    assert.ok(calls.every((call) => call.dtype === 'q8'));
    assert.ok(progress.some((event) => event.status === 'backend-fallback'));
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
