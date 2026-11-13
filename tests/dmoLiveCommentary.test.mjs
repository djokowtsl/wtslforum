import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as phrasebook from '../lib/dmoCommentaryPhrasebook.mjs';
import * as script from '../lib/dmoCommentaryScript.mjs';
import { createDmoLiveClipVoice, loadDmoLiveClipVoice } from '../lib/dmoLiveClipVoice.mjs';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

function compile(path, mocks) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  return module.exports;
}

function liveModule({ payload = null, blobs = new Map(), botCalls = [], queries = [] } = {}) {
  const blob = {
    get: async (key) => blobs.has(key)
      ? { statusCode: 200, stream: new Response(blobs.get(key)).body, blob: { size: 1 } }
      : null,
    put: async (key, body) => { blobs.set(key, typeof body === 'string' ? body : new Uint8Array(body)); },
  };
  const track = compile('lib/dmoCommentaryTrack.ts', {
    'node:crypto': require('node:crypto'),
    '@vercel/blob': blob,
    '@/lib/dmoReplayCharacterStyles': {},
    '@/lib/dmoReplayCommentary': {},
    '@/lib/dmoReplayTour': {},
    '@/lib/dmoTournamentName.mjs': {},
    '@/lib/liveScores': {},
    '@/lib/dmoCommentaryScript.mjs': script,
  });
  const live = compile('lib/dmoLiveCommentary.ts', {
    'node:crypto': require('node:crypto'),
    '@vercel/blob': blob,
    '@/lib/db': { sql: async (strings, ...values) => { queries.push([strings.join('?'), values]); return payload ? [{ payload }] : []; } },
    '@/lib/liveScores': { getDmoCommentaryContext: async () => null },
    '@/lib/te4DmoSurface': { surfaceForDmoTournament: () => 'Clay' },
    '@/lib/dmoCommentaryPhrasebook.mjs': phrasebook,
    '@/lib/dmoCommentaryScript.mjs': script,
    '@/lib/dmoCommentaryTrack': track,
  });
  globalThis.fetch = async (_url, init) => {
    botCalls.push(JSON.parse(init.body));
    return new Response(new Uint8Array([0xff, 0xfb]), { headers: { 'content-type': 'audio/mpeg' } });
  };
  process.env.WTSL_CORE_API_URL = 'https://bot.test';
  process.env.WTSL_CORE_API_KEY = 'secret';
  return live;
}

const id = '3f1c2a5e-8b8e-4b6f-9a51-6f2b0c9d1e77';
const payload = { players: ['gifu', 'Debuffy'], tournamentName: 'Roland-Garros', tournamentRound: 'Final',
  snapshot: { stadium: 'Paris', bestOf: 3 } };

test('only a watchable broadcast with verified players gets commentary', async () => {
  const queries = [];
  const live = liveModule({ payload, queries });
  const broadcast = await live.findLiveCommentaryBroadcast(id);
  assert.deepEqual(broadcast.names, ['gifu', 'Debuffy']);
  assert.equal(broadcast.round, 'Final');
  assert.match(queries[0][0], /status IN \('live', 'ended'\) AND expires_at > NOW\(\)/);
  assert.equal(await liveModule({ payload: null }).findLiveCommentaryBroadcast(id), null);
  assert.equal(await liveModule({ payload: { players: ['gifu', ''] } }).findLiveCommentaryBroadcast(id), null);
});

test('the phrasebook is built once per broadcast and stored', async () => {
  const blobs = new Map();
  const live = liveModule({ payload, blobs });
  const broadcast = await live.findLiveCommentaryBroadcast(id);
  const book = await live.getDmoLivePhrasebook(broadcast, 'store');
  assert.equal(book.lines.length, 600);
  assert.ok(book.lines.every((line) => /^[0-9a-f]{32}$/.test(line.clip)));
  const again = await liveModule({ payload, blobs }).getDmoLivePhrasebook(broadcast, 'store');
  assert.deepEqual(again.lines, book.lines, 'a new server instance reads the stored phrasebook');
});

test('preparation stores clips in order and carries on where it stopped', async () => {
  const blobs = new Map(); const botCalls = [];
  const live = liveModule({ payload, blobs, botCalls });
  const broadcast = await live.findLiveCommentaryBroadcast(id);
  const book = await live.getDmoLivePhrasebook(broadcast, 'store');
  let clock = 0;
  const realNow = Date.now;
  Date.now = () => clock;
  try {
    // Each bot call "takes" one second; a 10 second budget stores about ten.
    globalThis.fetch = async (_url, init) => {
      clock += 1_000; botCalls.push(JSON.parse(init.body));
      return new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'audio/mpeg' } });
    };
    const first = await live.prepareDmoLivePhrasebook(broadcast, book, 'store', 10_000);
    assert.ok(first.ready >= 10 && first.ready < 15, `${first.ready} prepared`);
    assert.deepEqual(botCalls.map((call) => call.text), book.lines.slice(0, botCalls.length).map((line) => line.text));
    const storedJson = JSON.parse([...blobs].find(([key]) => key.startsWith('dmo-commentary/live/'))[1]);
    assert.equal(storedJson.prepared, first.ready, 'progress is saved for the next run');
    const stored = await live.getDmoLivePhrasebook(broadcast, 'store');
    const before = botCalls.length;
    await live.prepareDmoLivePhrasebook(broadcast, stored, 'store', 5_000);
    assert.equal(botCalls[before].text, book.lines[first.ready].text, 'the next run starts at the first unprepared line');
  } finally { Date.now = realNow; }
});

test('live lines come from storage, are made once if new, and must be commentary', async () => {
  const blobs = new Map(); const botCalls = [];
  const live = liveModule({ payload, blobs, botCalls });
  const broadcast = await live.findLiveCommentaryBroadcast(id);
  const book = await live.getDmoLivePhrasebook(broadcast, 'store');
  const known = book.lines[0];
  assert.ok(await live.getDmoLiveCommentaryClip(book, known, 'store'));
  assert.ok(await live.getDmoLiveCommentaryClip(book, known, 'store'));
  assert.equal(botCalls.length, 1, 'a phrasebook line is made once, then served from storage');

  const fresh = { voice: 'am_michael', text: '23 shots in this point now, and neither gifu nor Debuffy will give it up.' };
  assert.ok(await live.getDmoLiveCommentaryClip(book, fresh, 'store'), 'a genuine new line is allowed');
  assert.equal(await live.getDmoLiveCommentaryClip(book, { voice: 'af_heart', text: 'Visit my website for free prizes.' }, 'store'), null);
  assert.equal(await live.getDmoLiveCommentaryClip(book, { voice: 'bf_emma', text: known.text }, 'store'), null);
  assert.equal(botCalls.length, 2, 'refused lines never reach the bot');
});

test('the live clip voice fetches a line and returns Kokoro-shaped audio', async () => {
  const urls = [];
  const voice = createDmoLiveClipVoice({
    broadcastId: id,
    fetchImpl: async (url) => { urls.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(2) }; },
    decode: async () => ({ getChannelData: () => new Float32Array([0.5]), sampleRate: 24_000 }),
  });
  const audio = await voice.generate('Game, gifu.', { voice: 'am_michael' });
  assert.equal(audio.sampling_rate, 24_000);
  assert.equal(new URL(urls[0], 'https://x').searchParams.get('text'), 'Game, gifu.');
  assert.match(urls[0], new RegExp(`/api/live-dmo/${id}/commentary/clip\\?voice=am_michael`));
});

test('loading the live voice checks the broadcast first and reports refusals', async () => {
  await assert.rejects(loadDmoLiveClipVoice({
    broadcastId: id, decode: async () => null, fetchImpl: async () => ({ ok: false, status: 404 }),
  }), (error) => error.status === 404);
  const voice = await loadDmoLiveClipVoice({
    broadcastId: id,
    decode: async () => ({ getChannelData: () => new Float32Array([0.1]), sampleRate: 24_000 }),
    fetchImpl: async () => ({ ok: true, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(2) }),
  });
  assert.equal(typeof voice.prefetch, 'function', 'cached and prefetch-capable');
});
