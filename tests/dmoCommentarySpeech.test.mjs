import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDmoSpeechUrl,
  cleanDmoSpeechText,
  createDmoServerVoiceModel,
  decodeDmoWav,
  normalizeDmoSpeechRequest,
} from '../lib/dmoCommentarySpeech.mjs';

function wav16(samples, sampleRate = 24_000) {
  const data = samples.length * 2;
  const view = new DataView(new ArrayBuffer(44 + data));
  const write = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + data, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, data, true);
  samples.forEach((value, index) => view.setInt16(44 + index * 2, value, true));
  return view.buffer;
}

test('speech requests follow the same rules as the bot', () => {
  assert.deepEqual(
    normalizeDmoSpeechRequest({ text: ' Game, set and match — gifu! ', voice: 'af_heart' }),
    { text: 'Game, set and match — gifu!', voice: 'af_heart', speed: 1.03 },
  );
  assert.equal(normalizeDmoSpeechRequest({ text: '<b>', voice: 'af_heart' }), null);
  assert.equal(normalizeDmoSpeechRequest({ text: 'Deuce.', voice: 'bf_emma' }), null);
  assert.equal(normalizeDmoSpeechRequest({ text: 'x'.repeat(321), voice: 'af_heart' }), null);
  assert.equal(normalizeDmoSpeechRequest({ text: 'Deuce.', voice: 'af_heart', speed: '4' }), null);
});

test('player names with unusual symbols are cleaned before creating a speech URL', () => {
  assert.equal(cleanDmoSpeechText('Break point, D*bu#ffy!'), 'Break point, D bu ffy!');
  const url = buildDmoSpeechUrl({ text: 'Break point, Débuffy.', voice: 'am_michael', speed: 1.03 });
  assert.match(url, /^\/api\/dmo-commentary\/speech\?voice=am_michael&speed=1\.03&text=/);
  assert.equal(new URL(url, 'https://example.test').searchParams.get('text'), 'Break point, Débuffy.');
});

test('16-bit mono WAV decodes into Kokoro-shaped audio', () => {
  const { audio, sampling_rate: rate } = decodeDmoWav(wav16([0, 16384, -32768]));
  assert.equal(rate, 24_000);
  assert.deepEqual([...audio], [0, 0.5, -1]);
  assert.throws(() => decodeDmoWav(new ArrayBuffer(4)), /not a WAV/);
  assert.throws(() => decodeDmoWav(wav16([1]).slice(0, 45)), /truncated/);
});

test('server model requests cacheable URLs and reports upstream failures', async () => {
  const urls = [];
  const model = createDmoServerVoiceModel({
    fetchImpl: async (url) => {
      urls.push(url);
      return { ok: true, arrayBuffer: async () => wav16([100, 200]) };
    },
  });
  assert.equal(model.dmoVoiceSource, 'server');
  const result = await model.generate('Deuce.', { voice: 'am_michael', speed: 1.03 });
  assert.equal(result.audio.length, 2);
  assert.match(urls[0], /voice=am_michael/);

  const failing = createDmoServerVoiceModel({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(failing.generate('Deuce.', { voice: 'af_heart' }), /returned 503/);
});

test('a refused speech request keeps its HTTP status so the button can ask the viewer to sign in', async () => {
  const model = createDmoServerVoiceModel({ fetchImpl: async () => ({ ok: false, status: 401 }) });
  await assert.rejects(model.generate('Deuce.', { voice: 'af_heart' }), (error) => error.status === 401);
});
