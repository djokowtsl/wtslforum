import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import test from 'node:test';
import * as commentary from '../lib/dmoCommentary.mjs';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const source = await readFile(new URL('../components/useDmoCommentary.ts', import.meta.url), 'utf8');
const compiled = transformSync(source, {
  filename: 'useDmoCommentary.ts',
  jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
  module: { type: 'commonjs' },
}).code;

// Run the real hook against deterministic speech, playback, fetch and timers.
// No browser audio service, account, paid provider or match data is contacted.
function harness(voices = [
  { voiceURI: 'us-female', name: 'Microsoft Aria Natural', lang: 'en-US' },
  { voiceURI: 'us-male', name: 'Microsoft Guy Natural', lang: 'en-US' },
], { localModel = null, loadModel = async () => localModel } = {}) {
  const originals = Object.fromEntries(['window', 'SpeechSynthesisUtterance', 'fetch',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].map((key) => [key, globalThis[key]]));
  const originalNow = Date.now;
  const slots = [], spoken = [], generated = [], requests = [], storage = new Map(), timers = new Map();
  let now = 100_000, cursor = 0, dirty = false, effects = [], output, id = 0;
  const playback = { frame: 1000, playing: true, rallyActive: false, rallyShotCount: 0 };
  class FakeAudioContext {
    state = 'running';
    destination = {};
    async resume() {}
    createBuffer() { return { copyToChannel() {} }; }
    createBufferSource() {
      return {
        buffer: null,
        onended: null,
        connect() {},
        start() { this.onended?.(); },
        stop() { this.onended?.(); },
      };
    }
  }
  const synthesis = {
    speaking: false, pending: false, getVoices: () => voices,
    addEventListener() {}, removeEventListener() {},
    speak: (utterance) => { spoken.push(utterance); synthesis.speaking = true; },
    cancel: () => { synthesis.speaking = false; },
  };
  globalThis.window = { speechSynthesis: synthesis, AudioContext: FakeAudioContext,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.fetch = (url) => new Promise((resolve) => requests.push({ url, resolve }));
  Date.now = () => now;
  const timer = (fn, delay, interval = false) => {
    const key = ++id; timers.set(key, { fn, at: now + delay, interval: interval ? delay : 0 }); return key;
  };
  globalThis.setTimeout = (fn, delay = 0) => timer(fn, delay);
  globalThis.setInterval = (fn, delay) => timer(fn, delay, true);
  globalThis.clearTimeout = globalThis.clearInterval = (key) => timers.delete(key);
  const changed = (previous, deps) => !previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]));
  const hooks = {
    useState: (initial) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (value) => {
        const next = typeof value === 'function' ? value(slots[i]) : value;
        if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; }
      }];
    },
    useRef: (initial) => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo: (fn, deps) => {
      const i = cursor++;
      if (changed(slots[i], deps)) slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useCallback: (fn, deps) => hooks.useMemo(() => fn, deps),
    useEffect: (fn, deps) => {
      const i = cursor++;
      if (changed(slots[i], deps)) {
        const cleanup = slots[i]?.cleanup;
        slots[i] = { deps };
        effects.push(() => { cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const mod = new Module(import.meta.url);
  mod.require = (name) => name === 'react' ? hooks
    : name === '@/lib/dmoCommentary.mjs' ? commentary
      : name === '@/lib/dmoLocalVoice.mjs' ? { loadDmoLocalVoiceModel: loadModel } : require(name);
  mod._compile(compiled, 'useDmoCommentary.js');
  let options = { snapshot: { pointCount: 0, recentPoints: [] },
    commentaryNames: ['gifu', 'TheTinkerman_'], commentaryPoints: [], fullReplay: false,
    replayFrame: 0, surface: 'Hard', isWta: false, soundEnabled: true, soundReady: true,
    playbackState: () => playback };
  const render = (patch = {}) => {
    options = { ...options, ...patch };
    let attempts = 0;
    do {
      dirty = false; cursor = 0; effects = [];
      output = mod.exports.useDmoCommentary(options);
      effects.forEach((fn) => fn());
      assert.ok(++attempts < 12, 'hook settles');
    } while (dirty);
    return output;
  };
  const advance = (milliseconds) => {
    const end = now + milliseconds;
    let attempts = 0;
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, value]) => value.at <= end);
      if (!entry) break;
      const [key, value] = entry; now = value.at;
      if (value.interval) value.at += value.interval; else timers.delete(key);
      value.fn(); render();
      assert.ok(++attempts < 10_000, 'timers settle');
    }
    now = end; render();
  };
  const finish = () => {
    for (const utterance of spoken) utterance.onend?.();
    synthesis.speaking = false;
  };
  const cleanup = () => {
    for (const slot of slots) slot?.cleanup?.();
    Object.assign(globalThis, originals); Date.now = originalNow;
  };
  const flush = () => new Promise((resolve) => originalSetImmediate(resolve));
  render();
  return { render, advance, finish, cleanup, spoken, generated, playback, requests, storage, flush,
    value: () => output, synthesis };
}

test('live reactions wait for the visible point end and finish after the next rally starts', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.advance(0);
    assert.match(h.spoken[0].text, /gifu against The Tinkerman/);
    assert.match(h.requests[0].url, /first=gifu&second=TheTinkerman_/);
    h.finish(); h.advance(12_000);
    h.render({ snapshot: { pointCount: 1,
      recentPoints: [{ number: 1, frame: 1200, winner: 2, server: 1, rallyHits: 10 }] } });
    h.advance(2000);
    assert.equal(h.spoken.length, 2, 'does not announce the source result early');
    h.playback.frame = 1200; h.advance(500);
    assert.equal(h.spoken.length, 3);
    assert.equal(h.synthesis.speaking, true);
    h.playback.rallyActive = true; h.advance(200);
    assert.equal(h.synthesis.speaking, true);
  } finally { h.cleanup(); }
});

test('a point exchange alternates between the selected female and male voices', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.advance(0); h.finish(); h.advance(12_000);
    h.render({ snapshot: { pointCount: 2, recentPoints: [
      { number: 1, frame: 1100, winner: 1, server: 1, rallyHits: 5 },
      { number: 2, frame: 1200, winner: 2, server: 2, rallyHits: 6 },
    ] } });
    h.playback.frame = 1200; h.advance(500);
    assert.equal(h.spoken.length, 4);
    assert.equal(h.spoken[2].voice.voiceURI, 'us-male');
    assert.equal(h.spoken[3].voice.voiceURI, 'us-female');
    assert.match(h.spoken[2].text, /The Tinkerman/);
    assert.match(h.spoken[3].text, /The Tinkerman/);
  } finally { h.cleanup(); }
});

test('commentary opening starts directly from the commentary button gesture', async () => {
  const h = harness();
  try {
    await h.value().toggle();
    assert.equal(h.spoken.length, 2);
    assert.match(h.spoken[0].text, /gifu against The Tinkerman/);
    assert.ok(h.spoken[1].text.length > 0);
  } finally { h.cleanup(); }
});

test('opening points use a shorter voice cooldown so commentary starts sooner', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.finish(); h.advance(7_500);
    h.render({ snapshot: { pointCount: 1,
      recentPoints: [{ number: 1, frame: 1000, winner: 1, server: 1, rallyHits: 5 }] } });
    h.advance(500);
    assert.equal(h.spoken.length, 3);
  } finally { h.cleanup(); }
});

test('long rallies can receive a measured call before the point ends', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.finish(); h.advance(8_000);
    h.playback.rallyActive = true;
    h.playback.rallyShotCount = 8;
    h.advance(200);
    assert.equal(h.spoken.length, 3);
    assert.match(h.spoken[2].text, /rally|point/i);
    assert.match(h.spoken[2].text, /gifu|The Tinkerman/);
  } finally { h.cleanup(); }
});

test('commentary reports when the browser refuses to start speech', async () => {
  const h = harness();
  try {
    h.synthesis.speak = () => { throw new Error('speech blocked'); };
    await h.value().toggle(); h.render();
    assert.match(h.value().error, /commentary voice could not start/);
  } finally { h.cleanup(); }
});

test('point reactions are not dropped when the next rally starts', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.advance(0); h.finish(); h.advance(12_000);
    h.render({ snapshot: { pointCount: 1,
      recentPoints: [{ number: 1, frame: 1000, winner: 1, server: 1, rallyHits: 12 }] } });
    h.playback.rallyActive = true; h.advance(2000);
    assert.equal(h.spoken.length, 3);
    assert.match(h.spoken[2].text, /gifu|point/i);
  } finally { h.cleanup(); }
});

test('longer WTSL facts require three continuous quiet seconds', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.advance(0); h.finish();
    h.requests[0].resolve({ ok: true, json: async () => ({ context: {
      tour: 'ATP', players: [{ rank: 1 }, { rank: 2 }], headToHead: null,
    } }) });
    await new Promise((resolve) => originalSetImmediate(resolve));
    h.render(); h.advance(14_000);
    assert.equal(h.spoken.length, 2, 'does not start facts in a short gap');
    h.playback.rallyActive = true; h.advance(1000);
    assert.equal(h.spoken.length, 2, 'never starts during a rally');
    h.playback.rallyActive = false; h.advance(2900);
    assert.equal(h.spoken.length, 2, 'quiet timer resets after rally activity');
    h.advance(500);
    assert.equal(h.spoken.length, 3);
    assert.match(h.spoken[2].text, /WTSL ATP rankings/);
  } finally { h.cleanup(); }
});

test('pause cancels speech without reporting an intentional cancellation as failure', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.advance(0);
    const first = h.spoken[0];
    h.playback.playing = false; h.advance(200);
    assert.equal(h.synthesis.speaking, false);
    first.onerror({ error: 'interrupted' }); h.render();
    assert.equal(h.value().error, '');
    await h.value().previewVoice();
    h.spoken.at(-1).onerror({ error: 'synthesis-failed' }); h.render();
    assert.match(h.value().error, /could not play/);
  } finally { h.cleanup(); }
});

test('changing player pair rejects delayed facts from the previous match', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.advance(0); h.finish();
    h.render({ commentaryNames: ['new first', 'new second'] });
    assert.equal(h.value().enabled, false);
    h.requests[0].resolve({ ok: true, json: async () => ({ context: {
      tour: 'ATP', players: [{ rank: 1 }, { rank: 2 }], headToHead: null,
    } }) });
    await new Promise((resolve) => originalSetImmediate(resolve));
    h.render(); h.advance(30_000);
    assert.equal(h.spoken.length, 2);
  } finally { h.cleanup(); }
});

const originalSetImmediate = globalThis.setImmediate;

test('one English voice remains usable and missing WTSL names never use character names', async () => {
  const h = harness([{ voiceURI: 'basic', name: 'Basic UK', lang: 'en-GB' }]);
  try {
    await h.value().toggle(); h.render();
    assert.equal(h.value().enabled, true);
    h.advance(0);
    assert.equal(h.spoken.length, 2);
    assert.match(h.spoken[0].text, /gifu against The Tinkerman/);
    assert.equal(h.spoken[0].voice.voiceURI, h.spoken[1].voice.voiceURI);
    assert.notEqual(h.spoken[0].pitch, h.spoken[1].pitch);
    h.render({ commentaryNames: null });
    h.value().toggle(); h.render();
    assert.match(h.value().error, /character names will not be used/);
  } finally { h.cleanup(); }
});

test('voice preview uses two automatic voices and mute cancels commentary', async () => {
  const voices = ['British Natural', 'Australian Natural'].map((name, i) =>
    ({ voiceURI: `voice${i}`, name, lang: i ? 'en-AU' : 'en-GB' }));
  const h = harness(voices);
  try {
    await h.value().previewVoice();
    assert.equal(h.spoken[0].voice.voiceURI, 'voice0');
    assert.equal(h.spoken[1].voice.voiceURI, 'voice1');
    assert.equal(h.spoken[0].rate, 1.03);
    assert.equal(h.spoken[0].pitch, 1);
    assert.equal(h.value().changeVoice, undefined);
    assert.equal(h.storage.get('wtsl-commentary-natural-voice'), undefined);
    h.render({ soundEnabled: false });
    assert.equal(h.synthesis.speaking, false);
    assert.equal(h.value().enabled, false);
  } finally { h.cleanup(); }
});

test('local Kokoro preview alternates its on-device voices', async () => {
  const localModel = {
    async generate(text, options) {
      generated.push({ text, ...options });
      return { audio: new Float32Array([0.1, -0.1]), sampling_rate: 24_000 };
    },
  };
  const generated = [];
  const h = harness(undefined, { localModel });
  try {
    await h.value().previewVoice();
    await h.flush();
    assert.deepEqual(generated.map(({ voice }) => voice), ['af_heart', 'am_michael']);
    h.render();
    assert.match(h.value().voiceStatus, /generated on this device/);
    assert.equal(h.spoken.length, 0, 'local model audio does not use browser speech synthesis');
  } finally { h.cleanup(); }
});

test('commentary opens with local Kokoro voices after loading the model', async () => {
  const generated = [];
  const localModel = {
    async generate(text, options) {
      generated.push({ text, ...options });
      return { audio: new Float32Array([0.1, -0.1]), sampling_rate: 24_000 };
    },
  };
  const h = harness(undefined, { localModel });
  try {
    await h.value().toggle();
    await h.flush();
    h.render();
    assert.equal(h.value().enabled, true);
    assert.deepEqual(generated.map(({ voice }) => voice), ['af_heart', 'am_michael']);
    assert.equal(h.spoken.length, 0, 'commentary uses local audio rather than browser speech synthesis');
  } finally { h.cleanup(); }
});

test('first-use voice download reports progress while commentary controls are busy', async () => {
  let finishLoad;
  const generated = [];
  const localModel = {
    async generate(text, options) {
      generated.push({ text, ...options });
      return { audio: new Float32Array([0.1, -0.1]), sampling_rate: 24_000 };
    },
  };
  const h = harness(undefined, {
    loadModel: (onProgress) => new Promise((resolve) => {
      onProgress({ status: 'progress', progress: 42, total: 100 });
      finishLoad = () => resolve(localModel);
    }),
  });
  try {
    const preview = h.value().previewVoice();
    await h.flush();
    h.render();
    assert.equal(h.value().voiceLoading, true);
    assert.match(h.value().voiceStatus, /42%/);
    finishLoad();
    await preview;
    await h.flush();
    h.render();
    assert.equal(h.value().voiceLoading, false);
    assert.match(h.value().voiceStatus, /generated on this device/);
    assert.deepEqual(generated.map(({ voice }) => voice), ['af_heart', 'am_michael']);
  } finally { h.cleanup(); }
});
