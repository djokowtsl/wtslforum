import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import test from 'node:test';
import * as commentary from '../lib/dmoCommentary.mjs';
import { isDmoLocalVoiceDeviceSupported } from '../lib/dmoLocalVoice.mjs';
import { canViewDmoVoiceDiagnostics } from '../lib/dmoVoiceDiagnostics.mjs';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');
const source = await readFile(new URL('../components/useDmoCommentary.ts', import.meta.url), 'utf8');
const courtSource = await readFile(new URL('../components/DmoLiveCourt3D.tsx', import.meta.url), 'utf8');
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
], {
  localModel = null,
  loadModel = null,
  localVoiceSupported = true,
  mobileLocalVoicePreview = false,
  audioContextAvailable = true,
  holdAudioPlayback = false,
  audioDuration = 0,
} = {}) {
  const originals = Object.fromEntries(['window', 'SpeechSynthesisUtterance', 'fetch',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].map((key) => [key, globalThis[key]]));
  const originalNow = Date.now;
  const slots = [], spoken = [], generated = [], requests = [], storage = new Map(), timers = new Map();
  const audioCompletions = [];
  const defaultModel = {
    async generate(text, options) {
      generated.push({ text, ...options });
      return { audio: new Float32Array([0.1, -0.1]), sampling_rate: 24_000 };
    },
  };
  const loadKokoro = loadModel ?? (async () => localModel ?? defaultModel);
  let now = 100_000, cursor = 0, dirty = false, effects = [], output, id = 0;
  let pointCommentaryCalls = 0;
  const hookCommentary = {
    ...commentary,
    buildDmoPointCommentary(...args) {
      pointCommentaryCalls += 1;
      return commentary.buildDmoPointCommentary(...args);
    },
  };
  const playback = { frame: 1000, playing: true, rallyActive: false, rallyShotCount: 0 };
  class FakeAudioContext {
    state = 'running';
    destination = {};
    async resume() {}
    createBuffer() { return { duration: audioDuration, copyToChannel() {} }; }
    createBufferSource() {
      return {
        buffer: null,
        onended: null,
        connect() {},
        start() {
          if (holdAudioPlayback) audioCompletions.push(() => this.onended?.());
          else this.onended?.();
        },
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
  globalThis.window = { speechSynthesis: synthesis,
    AudioContext: audioContextAvailable ? FakeAudioContext : undefined,
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
    : name === '@/lib/dmoCommentary.mjs' ? hookCommentary
      : name === '@/lib/dmoLocalVoice.mjs'
        ? {
          canUseDmoLocalVoice: () => localVoiceSupported,
          isMobileDmoLocalVoiceDevice: () => mobileLocalVoicePreview,
          loadDmoLocalVoiceModel: loadKokoro,
        }
        : require(name);
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
  const flush = async () => {
    for (let turn = 0; turn < 3; turn += 1) {
      await new Promise((resolve) => originalSetImmediate(resolve));
    }
  };
  const value = () => Object.assign(Object.create(output), {
    toggle: async (...args) => {
      output.toggle(...args);
      await flush();
    },
  });
  render();
  return { render, advance, finish, cleanup, spoken: generated, nativeSpoken: spoken,
    generated, playback, requests, storage, flush, value, synthesis,
    finishAudio: () => audioCompletions.shift()?.(),
    get pointCommentaryCalls() { return pointCommentaryCalls; } };
}

async function enableLoadedKokoro(h) {
  h.value().toggle(); h.render();
  await h.flush(); h.render();
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
    await h.flush(); h.render();
    assert.equal(h.pointCommentaryCalls, 1, 'the completed point reaches the commentary builder');
    h.advance(2000);
    assert.equal(h.spoken.length, 2, 'does not announce the source result early');
    h.playback.frame = 1200; h.advance(500);
    await h.flush(); h.render();
    assert.equal(h.spoken.length, 4);
    assert.match(h.spoken[3].text, /Exactly|Absolutely|right/i);
    assert.equal(h.nativeSpoken.length, 0);
    h.playback.rallyActive = true; h.advance(200);
    assert.equal(h.spoken.length, 4);
  } finally { h.cleanup(); }
});

test('every verified game ending gets a short call, including routine holds', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.advance(0); h.finish(); h.advance(12_000);
    h.render({ snapshot: { pointCount: 2, recentPoints: [
      { number: 1, frame: 1100, winner: 1, server: 1, rallyHits: 5, scoreLabel: '0-0(30-30)' },
      { number: 2, frame: 1200, winner: 1, server: 1, rallyHits: 5, scoreLabel: '1-0(0-0)' },
    ] } });
    h.playback.frame = 1200; h.advance(500);
    await h.flush(); h.render();
    assert.equal(h.spoken.length, 3);
    assert.match(h.spoken[2].text, /game/i);
    h.finish(); h.advance(10_000);
    h.render({ snapshot: { pointCount: 3, recentPoints: [
      { number: 1, frame: 1100, winner: 1, server: 1, rallyHits: 5, scoreLabel: '0-0(30-30)' },
      { number: 2, frame: 1200, winner: 1, server: 1, rallyHits: 5, scoreLabel: '1-0(30-40)' },
      { number: 3, frame: 1300, winner: 2, server: 1, rallyHits: 5, scoreLabel: '1-1(0-0)' },
    ] } });
    await h.flush(); h.render();
    h.playback.frame = 1300; h.advance(500);
    await h.flush(); h.render();
    assert.equal(h.spoken.length, 4);
    assert.equal(h.spoken[2].voice, 'am_michael');
    assert.equal(h.spoken[3].voice, 'af_heart');
    assert.match(h.spoken[3].text, /break/i);
  } finally { h.cleanup(); }
});

test('live point scores such as 15-30 never become game announcements', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.advance(0); h.finish(); h.advance(12_000);
    h.render({ snapshot: { pointCount: 2, recentPoints: [
      { number: 1, frame: 1100, winner: 2, server: 1, rallyHits: 2, scoreLabel: '15-30' },
      { number: 2, frame: 1200, winner: 2, server: 1, rallyHits: 2, scoreLabel: '16-30' },
    ] } });
    h.playback.frame = 1200; h.advance(500);
    assert.equal(h.spoken.length, 2);
  } finally { h.cleanup(); }
});

test('game-ending calls survive a busy voice and later point updates', async () => {
  const h = harness(undefined, { holdAudioPlayback: true, audioDuration: 60 });
  const points = [
    { number: 1, frame: 1100, winner: 1, server: 1, rallyHits: 4, scoreLabel: '0-0(40-30)' },
    { number: 2, frame: 1200, winner: 1, server: 1, rallyHits: 4, scoreLabel: '1-0(0-0)' },
  ];
  try {
    await enableLoadedKokoro(h);
    h.playback.frame = 1200;
    h.render({ snapshot: { pointCount: 2, recentPoints: points } });
    h.advance(10_000);
    await h.flush(); h.render();
    assert.equal(h.generated.length, 2, 'the opening is still occupying the voice');
    h.render({ snapshot: { pointCount: 3, recentPoints: [
      ...points,
      { number: 3, frame: 1300, winner: 2, server: 2, rallyHits: 12, scoreLabel: '1-0(0-15)' },
    ] } });
    h.playback.frame = 1300;
    h.finishAudio(); await h.flush();
    h.finishAudio(); await h.flush();
    h.advance(200); await h.flush(); h.render();
    assert.equal(h.generated.length, 3);
    assert.match(h.generated[2].text, /game/i, 'a later point cannot replace the queued game ending');
    h.finishAudio(); await h.flush();
  } finally { h.cleanup(); }
});

test('batched replay updates preserve every completed game', async () => {
  const h = harness();
  try {
    h.playback.frame = 0;
    h.render({ fullReplay: true, replayFrame: 0, commentaryPoints: [
      { number: 4, frame: 100, winner: 1, server: 1, rallyHits: 4,
        scoreBeforeLabel: '0-0(40-30)', scoreAfterLabel: '1-0(0-0)' },
      { number: 8, frame: 200, winner: 2, server: 2, rallyHits: 4,
        scoreBeforeLabel: '1-0(30-40)', scoreAfterLabel: '1-1(0-0)' },
    ] });
    await enableLoadedKokoro(h);
    h.advance(1000);
    h.playback.frame = 300;
    h.render({ replayFrame: 300 });
    h.advance(200); await h.flush(); h.render();
    h.advance(600); await h.flush(); h.render();
    assert.equal(h.generated.length, 4, 'opening plus one short call for each game');
    assert.ok(h.generated.slice(2).every((line) => /game/i.test(line.text)));
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

test('routine opening points remain quiet after the voice cooldown', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.finish(); h.advance(7_500);
    h.render({ snapshot: { pointCount: 1,
      recentPoints: [{ number: 1, frame: 1000, winner: 1, server: 1, rallyHits: 5 }] } });
    h.advance(10_000);
    assert.equal(h.spoken.length, 2);
  } finally { h.cleanup(); }
});

test('long rallies can receive a measured call before the point ends', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.finish(); h.advance(8_000);
    h.playback.rallyActive = true;
    h.playback.rallyShotCount = 10;
    h.advance(200);
    await h.flush(); h.render();
    assert.equal(h.spoken.length, 3);
    assert.match(h.spoken[2].text, /rally|point/i);
    assert.match(h.spoken[2].text, /gifu|The Tinkerman/);
  } finally { h.cleanup(); }
});

test('commentary never invokes device speech when Kokoro is unavailable', async () => {
  let loads = 0;
  const h = harness(undefined, {
    audioContextAvailable: false,
    loadModel: async () => {
      loads += 1;
      return { async generate() {
        return { audio: new Float32Array([0.1]), sampling_rate: 24_000 };
      } };
    },
  });
  try {
    await h.value().toggle(); await h.flush(); h.render();
    assert.equal(loads, 1, 'Kokoro loads without a shared Web Audio context');
    assert.equal(h.nativeSpoken.length, 0);
    assert.equal(h.spoken.length, 0);
  } finally { h.cleanup(); }
});

test('point reactions are not dropped when the next rally starts', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.advance(0); h.finish(); h.advance(12_000);
    h.render({ snapshot: { pointCount: 1,
      recentPoints: [{ number: 1, frame: 1000, winner: 1, server: 1, rallyHits: 12 }] } });
    h.playback.rallyActive = true; h.advance(2000);
    await h.flush(); h.render();
    assert.equal(h.spoken.length, 4);
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
    await h.flush(); h.render();
    assert.equal(h.spoken.length, 3);
    assert.match(h.spoken[2].text, /WTSL ATP rankings/);
  } finally { h.cleanup(); }
});

test('pause cancels Kokoro playback without using another voice', async () => {
  const h = harness();
  try {
    await h.value().toggle(); h.render(); h.advance(0);
    h.playback.playing = false; h.advance(200);
    assert.equal(h.value().error, '');
    assert.equal(h.nativeSpoken.length, 0);
    assert.ok(h.spoken.length >= 2);
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
    assert.notEqual(h.spoken[0].voice, h.spoken[1].voice);
    h.render({ commentaryNames: null });
    h.value().toggle(); h.render();
    assert.match(h.value().error, /character names will not be used/);
  } finally { h.cleanup(); }
});

test('Kokoro uses two local voices and mute cancels commentary', async () => {
  const voices = ['British Natural', 'Australian Natural'].map((name, i) =>
    ({ voiceURI: `voice${i}`, name, lang: i ? 'en-AU' : 'en-GB' }));
  const h = harness(voices);
  try {
    await h.value().toggle();
    assert.equal(h.spoken[0].voice, 'af_heart');
    assert.equal(h.spoken[1].voice, 'am_michael');
    assert.equal(h.value().changeVoice, undefined);
    assert.equal(h.storage.get('wtsl-commentary-natural-voice'), undefined);
    h.render({ soundEnabled: false });
    assert.equal(h.synthesis.speaking, false);
    assert.equal(h.value().enabled, false);
  } finally { h.cleanup(); }
});

test('turning on commentary automatically loads Kokoro and alternates its voices', async () => {
  const localModel = {
    async generate(text, options) {
      generated.push({ text, ...options });
      return { audio: new Float32Array([0.1, -0.1]), sampling_rate: 24_000 };
    },
  };
  const generated = [];
  const h = harness(undefined, { localModel });
  try {
    await enableLoadedKokoro(h);
    assert.deepEqual(generated.map(({ voice }) => voice), ['af_heart', 'am_michael']);
    h.render();
    assert.match(h.value().voiceStatus, /generated on this device/);
    assert.equal(h.nativeSpoken.length, 0, 'local model audio does not use browser speech synthesis');
  } finally { h.cleanup(); }
});

test('commentary starts without a public status message', () => {
  const h = harness();
  try {
    assert.equal(h.value().voiceStatus, '');
  } finally { h.cleanup(); }
});

test('voice diagnostics render only for the designated viewer', () => {
  assert.match(courtSource, /showVoiceDiagnostics && \(soundError \|\| commentary\.error \|\| commentary\.voiceStatus\)/);
  assert.equal(canViewDmoVoiceDiagnostics(null), false);
});

test('commentary automatically loads Kokoro without a separate download action', async () => {
  const generated = [];
  let loads = 0;
  const localModel = {
    async generate(text, options) {
      generated.push({ text, ...options });
      return { audio: new Float32Array([0.1, -0.1]), sampling_rate: 24_000 };
    },
  };
  const h = harness(undefined, {
    localModel,
    loadModel: async () => {
      loads += 1;
      return localModel;
    },
  });
  try {
    await h.value().toggle();
    await h.flush();
    h.render();
    assert.equal(h.value().enabled, true);
    assert.equal(loads, 1, 'the commentary tap automatically prepares Kokoro');
    assert.equal(generated.length, 2);
    assert.equal(h.nativeSpoken.length, 0);
    assert.doesNotMatch(courtSource, /Preview Kokoro|Preview local voices|commentary\.previewVoice/);
  } finally { h.cleanup(); }
});

test('mobile Kokoro loads automatically during playback without a pause gate', async () => {
  const generated = [];
  let loads = 0;
  const model = {
    async generate(text, options) {
      generated.push({ text, ...options });
      return { audio: new Float32Array([0.1, -0.1]), sampling_rate: 24_000 };
    },
  };
  const h = harness(undefined, {
    localVoiceSupported: true,
    mobileLocalVoicePreview: true,
    loadModel: async () => {
      loads += 1;
      return model;
    },
  });
  try {
    await h.value().toggle();
    await h.flush();
    h.render();
    assert.equal(loads, 1, 'the commentary tap while playing loads the model');
    assert.equal(h.value().voiceLoading, false);
    assert.equal(h.nativeSpoken.length, 0);
    assert.match(h.value().voiceStatus, /generated on this device/);
  } finally { h.cleanup(); }
});

test('Kokoro download does not depend on an available shared audio context', async () => {
  let loads = 0;
  const model = { async generate() {
    return { audio: new Float32Array([0.1]), sampling_rate: 24_000 };
  } };
  const h = harness(undefined, {
    audioContextAvailable: false,
    loadModel: async () => { loads += 1; return model; },
  });
  try {
    h.value().toggle();
    assert.equal(h.spoken.length, 0, 'without Web Audio, wait and do not use a native voice');
    assert.equal(h.nativeSpoken.length, 0);
    await h.flush(); h.render();
    assert.equal(loads, 1, 'Kokoro still downloads when Web Audio is unavailable');
    assert.match(h.value().voiceStatus, /generated on this device/);
  } finally { h.cleanup(); }
});

test('Kokoro generation failures report the cause without device-speech fallback', async () => {
  const localModel = {
    async generate() {
      throw new Error('WASM memory allocation failed');
    },
  };
  const h = harness(undefined, { localModel });
  try {
    await enableLoadedKokoro(h);
    h.render();
    assert.equal(h.spoken.length, 0);
    assert.equal(h.nativeSpoken.length, 0);
    assert.match(h.value().voiceStatus, /Kokoro playback failed during local speech generation/);
    assert.match(h.value().error, /WASM memory allocation failed/);
  } finally { h.cleanup(); }
});

test('mobile Kokoro gives slower local speech generation more time', async () => {
  const finishGeneration = [];
  const h = harness(undefined, {
    mobileLocalVoicePreview: true,
    localModel: {
      generate() {
        return new Promise((resolve) => finishGeneration.push(resolve));
      },
    },
  });
  try {
    await enableLoadedKokoro(h);
    assert.equal(finishGeneration.length, 1);

    h.advance(20_000);
    assert.match(h.value().voiceStatus, /Generating commentary locally/);
    assert.equal(h.value().error, '');
    assert.equal(h.nativeSpoken.length, 0);

    const audio = { audio: new Float32Array([0.1, -0.1]), sampling_rate: 24_000 };
    finishGeneration[0](audio);
    await h.flush();
    assert.equal(finishGeneration.length, 2);
    finishGeneration[1](audio);
    await h.flush();
    h.render();

    assert.equal(finishGeneration.length, 2);
    assert.equal(h.nativeSpoken.length, 0);
    assert.equal(h.value().error, '');
    assert.match(h.value().voiceStatus, /Local Kokoro voices are ready/);
  } finally { h.cleanup(); }
});

test('the co-commentator is prepared while the first voice is still playing', async () => {
  let calls = 0;
  let finishReply;
  const audio = { audio: new Float32Array([0.1]), sampling_rate: 24_000 };
  const h = harness(undefined, {
    holdAudioPlayback: true,
    localModel: {
      generate() {
        calls += 1;
        return calls === 1 ? Promise.resolve(audio)
          : new Promise((resolve) => { finishReply = resolve; });
      },
    },
  });
  try {
    await enableLoadedKokoro(h);
    assert.equal(calls, 2, 'reply generation starts before the first audio ends');
    finishReply(audio);
    await h.flush();
    h.finishAudio();
    await h.flush();
    h.finishAudio();
    await h.flush(); h.render();
    assert.equal(h.value().error, '');
    assert.equal(h.nativeSpoken.length, 0);
    assert.match(h.value().voiceStatus, /voices are ready/);
  } finally { h.cleanup(); }
});

test('only Squeaky admins can see commentary diagnostics', () => {
  assert.equal(canViewDmoVoiceDiagnostics({ isAdmin: true, username: 'Squeaky' }), true);
  assert.equal(canViewDmoVoiceDiagnostics({ isAdmin: true, username: 'squeaky94' }), true);
  assert.equal(canViewDmoVoiceDiagnostics({ isAdmin: true, username: 'Other admin' }), false);
  assert.equal(canViewDmoVoiceDiagnostics({ isAdmin: false, username: 'Squeaky' }), false);
});

test('mobile and low-memory devices remain eligible for local Kokoro', () => {
  assert.equal(
    isDmoLocalVoiceDeviceSupported({ userAgent: 'Mozilla/5.0 (iPhone)', maxTouchPoints: 5 }),
    true,
  );
  assert.equal(
    isDmoLocalVoiceDeviceSupported({
      userAgent: 'Mozilla/5.0 (iPhone)',
      maxTouchPoints: 5,
      allowMobile: true,
    }),
    true,
  );
  assert.equal(
    isDmoLocalVoiceDeviceSupported({
      userAgent: 'Mozilla/5.0 (iPhone)',
      deviceMemory: 4,
      allowMobile: true,
    }),
    true,
  );
  assert.equal(
    isDmoLocalVoiceDeviceSupported({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', deviceMemory: 8 }),
    true,
  );
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
    const preview = h.value().toggle();
    assert.equal(h.spoken.length, 0, 'no speech starts before Kokoro is ready');
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
    assert.equal(generated.length, 2, 'the opening is generated once Kokoro finishes loading');
  } finally { h.cleanup(); }
});

test('commentary reuses the court audio context instead of creating a separate iOS audio session', async () => {
  let resumed = 0, started = 0, generated = 0;
  const shared = {
    state: 'interrupted',
    destination: {},
    async resume() { resumed += 1; this.state = 'running'; },
    createBuffer() { return { duration: 0.1, copyToChannel() {} }; },
    createBufferSource() {
      return {
        connect(destination) { assert.equal(destination, shared.destination); },
        start() { started += 1; this.onended(); },
      };
    },
  };
  const h = harness(undefined, { localModel: {
    async generate() {
      generated += 1;
      return { audio: new Float32Array([0.1]), sampling_rate: 24_000 };
    },
  } });
  try {
    h.render({ getAudioContext: () => shared });
    const start = h.value().toggle();
    assert.ok(resumed > 0, 'audio is resumed inside the tap, before the download');
    await start; await h.flush(); h.render();
    assert.equal(generated, 2);
    assert.equal(started, 2);
    assert.equal(h.nativeSpoken.length, 0);
    assert.match(courtSource, /getAudioContext: getCommentaryAudioContext/);
  } finally { h.cleanup(); }
});

test('slow desktop Kokoro generation is not abandoned or duplicated after 30 seconds', async () => {
  const pending = [];
  const audio = { audio: new Float32Array([0.1]), sampling_rate: 24_000 };
  const h = harness(undefined, {
    loadModel: (onProgress) => {
      onProgress({ status: 'backend', backend: 'wasm' });
      return Promise.resolve({
        generate: () => new Promise((resolve) => pending.push(resolve)),
      });
    },
  });
  try {
    await enableLoadedKokoro(h);
    assert.equal(pending.length, 1);
    h.advance(30_001); await h.flush(); h.render();
    assert.equal(h.spoken.length, 0);
    assert.equal(h.nativeSpoken.length, 0);
    assert.match(h.value().voiceStatus, /still generating locally on the CPU/);
    assert.equal(h.value().error, '', 'a slow generation remains active instead of being discarded');

    pending[0](audio);
    await h.flush(); h.render();
    assert.equal(pending.length, 2, 'the reply starts after the first generated call');
    pending[1](audio);
    await h.flush(); h.render();
    assert.equal(h.value().error, '');
    assert.equal(h.nativeSpoken.length, 0);
    assert.match(h.value().voiceStatus, /Local Kokoro voices are ready/);
  } finally { h.cleanup(); }
});

test('a failed automatic model download keeps commentary silent', async () => {
  const h = harness(undefined, { loadModel: async () => { throw new Error('offline'); } });
  try {
    await h.value().toggle(); await h.flush(); h.render();
    assert.equal(h.value().enabled, true);
    assert.equal(h.spoken.length, 0);
    assert.equal(h.nativeSpoken.length, 0);
    assert.match(h.value().voiceStatus, /could not load/);
  } finally { h.cleanup(); }
});

test('muting while Kokoro generates prevents delayed speech from escaping', async () => {
  let finish;
  const h = harness(undefined, { localModel: {
    generate: () => new Promise((resolve) => { finish = resolve; }),
  } });
  try {
    await enableLoadedKokoro(h);
    h.render({ soundEnabled: false });
    finish({ audio: new Float32Array([0.1]), sampling_rate: 24_000 });
    await h.flush(); h.render();
    assert.equal(h.value().enabled, false);
    assert.equal(h.spoken.length, 0);
  } finally { h.cleanup(); }
});
