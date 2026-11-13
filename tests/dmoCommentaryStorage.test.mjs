import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as script from '../lib/dmoCommentaryScript.mjs';

const require = createRequire(import.meta.url);
const { transformSync } = require('next/dist/build/swc');

function loadTrackModule({
  blobs,
  botCalls,
  contextCalls,
  fetchResponse = () => new Response(new Uint8Array([0xff, 0xfb, 1, 2]), {
    headers: { 'content-type': 'audio/mpeg' },
  }),
}) {
  const source = readFileSync(new URL('../lib/dmoCommentaryTrack.ts', import.meta.url), 'utf8');
  const { code } = transformSync(source, {
    jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  const mocks = {
    'node:crypto': require('node:crypto'),
    '@vercel/blob': {
      get: async (key) => blobs.has(key)
        ? { statusCode: 200, stream: new Response(blobs.get(key)).body, blob: { size: 1 } }
        : null,
      put: async (key, body) => { blobs.set(key, typeof body === 'string' ? body : new Uint8Array(body)); },
    },
    '@/lib/dmoReplayCharacterStyles': { alignDmoReplayPlayerStyles: (players) => players },
    '@/lib/dmoReplayCommentary': {
      buildDmoReplayCommentaryPoints: () => [
        { number: 1, frame: 300, winner: 1, server: 1, rallyHits: 3,
          scoreBeforeLabel: '0-0(40-0)', scoreAfterLabel: '1-0(0-0)', setBefore: 1, setAfter: 1 },
      ],
    },
    '@/lib/dmoReplayTour': { dmoReplayIsWta: () => false },
    '@/lib/dmoTournamentName.mjs': { normalizeDmoTournamentName: (value) => value },
    '@/lib/liveScores': { getDmoCommentaryContext: async (...args) => { contextCalls.push(args); return null; } },
    '@/lib/dmoCommentaryScript.mjs': script,
  };
  new Function('require', 'module', 'exports', code)((name) => {
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  globalThis.fetch = async (url, init) => {
    botCalls.push(JSON.parse(init.body));
    return fetchResponse(url, init);
  };
  process.env.WTSL_CORE_API_URL = 'https://bot.test';
  process.env.WTSL_CORE_API_KEY = 'secret';
  return module.exports;
}

const replay = { id: '21', tournament: 'Roland-Garros', player1: 'gifu', player2: 'Debuffy', privateBlobPathname: 'dmo/a.dmo' };
const viewer = { names: ['gifu', 'Debuffy'], match: { fps: 30 }, tournament: 'Roland-Garros', surface: 'Clay' };

test('the script is built once from the replay, then read from storage', async () => {
  const blobs = new Map(); const botCalls = []; const contextCalls = [];
  const track = loadTrackModule({ blobs, botCalls, contextCalls });
  let viewerLoads = 0;
  const loadViewer = async () => { viewerLoads += 1; return viewer; };
  const first = await track.getDmoCommentaryTrack(replay, loadViewer, 'store');
  assert.ok(first.cues.length >= 3, 'opening plus the game call');
  assert.ok(first.cues.every((cue) => /^[0-9a-f]{32}$/.test(cue.clip)));
  assert.ok([...blobs.keys()].some((key) => key.startsWith('dmo-commentary/scripts/21-')));

  const fresh = loadTrackModule({ blobs, botCalls, contextCalls }); // a new server instance
  const second = await fresh.getDmoCommentaryTrack(replay, loadViewer, 'store');
  assert.deepEqual(second.cues, first.cues);
  assert.equal(viewerLoads, 1, 'the recording is only read when the script is first built');
  assert.equal(botCalls.length, 0, 'building a script generates no audio');
});

test('clips are generated once as MP3, stored, and then served from storage', async () => {
  const blobs = new Map(); const botCalls = [];
  const track = loadTrackModule({ blobs, botCalls, contextCalls: [] });
  const built = await track.getDmoCommentaryTrack(replay, async () => viewer, 'store');
  const cue = built.cues[0];
  const audio = await track.getDmoCommentaryClip(built, cue.clip, 'store');
  assert.equal(audio[0], 0xff);
  assert.deepEqual(botCalls[0], { text: cue.text, voice: cue.voice, speed: cue.speed, format: 'mp3' });
  await track.getDmoCommentaryClip(built, cue.clip, 'store');
  assert.equal(botCalls.length, 1, 'the second request is served from storage');
  assert.ok(blobs.has(`dmo-commentary/clips/${cue.clip}.mp3`));
});

test('bot backpressure is marked as busy and carries its retry delay', async () => {
  const blobs = new Map(); const botCalls = [];
  const track = loadTrackModule({
    blobs,
    botCalls,
    contextCalls: [],
    fetchResponse: () => new Response(JSON.stringify({ error: 'speech_busy' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'retry-after': '3' },
    }),
  });
  const built = await track.getDmoCommentaryTrack(replay, async () => viewer, 'store');
  await assert.rejects(
    track.getDmoCommentaryClip(built, built.cues[0].clip, 'store'),
    (error) => error.busy === true && error.retryAfter === '3',
  );
  assert.equal(botCalls.length, 1);
});

test('only lines in the replay\'s own script can ever be turned into audio', async () => {
  const blobs = new Map(); const botCalls = [];
  const track = loadTrackModule({ blobs, botCalls, contextCalls: [] });
  const built = await track.getDmoCommentaryTrack(replay, async () => viewer, 'store');
  assert.equal(await track.getDmoCommentaryClip(built, 'f'.repeat(32), 'store'), null);
  assert.equal(botCalls.length, 0);
});

test('preparing stores every clip in script order and then marks the track complete', async () => {
  const blobs = new Map(); const botCalls = [];
  const track = loadTrackModule({ blobs, botCalls, contextCalls: [] });
  const built = await track.getDmoCommentaryTrack(replay, async () => viewer, 'store');
  const result = await track.prepareDmoCommentaryClips(replay, built, 'store');
  assert.equal(result.ready, result.total);
  assert.deepEqual(botCalls.map((call) => call.text), [...new Set(built.cues.map((cue) => cue.text))]);
  const again = loadTrackModule({ blobs, botCalls, contextCalls: [] });
  const stored = await again.getDmoCommentaryTrack(replay, async () => viewer, 'store');
  assert.equal(stored.complete, true);
  assert.deepEqual(await again.prepareDmoCommentaryClips(replay, stored, 'store'), result, 'nothing left to do');
  assert.equal(botCalls.length, result.total);
});

test('a viewer part-way through gets clips from their position stored first', () => {
  const { dmoCommentaryPreparationOrder: order } = loadTrackModule({ blobs: new Map(), botCalls: [], contextCalls: [] });
  const cues = [
    { clip: 'open', at: null }, { clip: 'p1', at: 300 }, { clip: 'join1', at: 900, kind: 'join' },
    { clip: 'p2', at: 1200 }, { clip: 'join2', at: 2000, kind: 'join' }, { clip: 'p3', at: 2400 },
  ];
  assert.deepEqual(order(cues, null).map((cue) => cue.clip), cues.map((cue) => cue.clip));
  assert.deepEqual(order(cues, 1000).map((cue) => cue.clip), ['join1', 'p2', 'p3', 'open', 'p1', 'join2']);
});
