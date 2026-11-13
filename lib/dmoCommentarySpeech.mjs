/**
 * Shared rules for server-generated commentary speech.
 *
 * Phones fetch each short line as WAV from the authenticated Forum route,
 * which relays it to the WTSL bot's local Kokoro model.
 */
export const DMO_SPEECH_VOICES = Object.freeze(['af_heart', 'am_michael']);
export const DMO_SPEECH_MAX_TEXT_LENGTH = 320;
export const DMO_SPEECH_DEFAULT_SPEED = 1.03;
const ALLOWED_TEXT = /^[\p{L}\p{N}_ .,!?'’"“”\-–—:;%()&/]+$/u;
const DISALLOWED_CHARACTER = /[^\p{L}\p{N}_ .,!?'’"“”\-–—:;%()&/]/gu;

/** Replace unusual symbols in names before sending a line to the speech model. */
export function cleanDmoSpeechText(text) {
  return String(text ?? '')
    .replace(DISALLOWED_CHARACTER, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DMO_SPEECH_MAX_TEXT_LENGTH)
    .trim();
}

/** Validate requests using the same voice, length, character and speed limits as the bot. */
export function normalizeDmoSpeechRequest({ text, voice, speed } = {}) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > DMO_SPEECH_MAX_TEXT_LENGTH || !ALLOWED_TEXT.test(clean)) return null;
  if (!DMO_SPEECH_VOICES.includes(voice)) return null;
  const rate = speed === undefined || speed === null || speed === ''
    ? DMO_SPEECH_DEFAULT_SPEED
    : Number(speed);
  if (!Number.isFinite(rate) || rate < 0.8 || rate > 1.25) return null;
  return { text: clean, voice, speed: Math.round(rate * 100) / 100 };
}

/** Identical lines resolve to one cacheable URL. */
export function buildDmoSpeechUrl({ text, voice, speed = DMO_SPEECH_DEFAULT_SPEED }) {
  const request = normalizeDmoSpeechRequest({ text: cleanDmoSpeechText(text), voice, speed });
  if (!request) return null;
  const query = new URLSearchParams({
    voice: request.voice,
    speed: request.speed.toFixed(2),
    text: request.text,
  });
  return `/api/dmo-commentary/speech?${query.toString()}`;
}

/** Decode the server's 16-bit mono PCM WAV into the shape Kokoro's client API returns. */
export function decodeDmoWav(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  const tag = (offset) => String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3),
  );
  if (view.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('Commentary audio is not a WAV file');
  }
  let format = null;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > view.byteLength) throw new Error('Commentary audio contains a truncated WAV chunk');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Commentary audio has an invalid WAV format');
      format = {
        code: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!format || format.channels < 1 || !(format.sampleRate > 0)) {
        throw new Error('Commentary audio has no usable format');
      }
      const bytesPerSample = format.bits / 8;
      const frameBytes = bytesPerSample * format.channels;
      if (!Number.isInteger(frameBytes) || frameBytes <= 0) {
        throw new Error('Commentary audio uses an unsupported sample format');
      }
      const frames = Math.floor(size / frameBytes);
      const audio = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame += 1) {
        const at = body + frame * frameBytes;
        if (format.code === 1 && format.bits === 16) audio[frame] = view.getInt16(at, true) / 32768;
        else if (format.code === 3 && format.bits === 32) audio[frame] = view.getFloat32(at, true);
        else throw new Error('Commentary audio uses an unsupported sample format');
      }
      return { audio, sampling_rate: format.sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('Commentary audio contains no samples');
}

/** A Kokoro-compatible generate() method backed by the WTSL server. */
export function createDmoServerVoiceModel({ fetchImpl = (...args) => fetch(...args) } = {}) {
  return {
    dmoVoiceSource: 'server',
    async generate(text, { voice = 'af_heart', speed = DMO_SPEECH_DEFAULT_SPEED } = {}) {
      const url = buildDmoSpeechUrl({ text, voice, speed });
      if (!url) throw new Error('Commentary line could not be prepared for speech');
      const response = await fetchImpl(url);
      if (!response.ok) {
        const error = new Error(`Commentary voice server returned ${response.status}`);
        // 401 means the viewer must sign in; the player button says so.
        error.status = response.status;
        throw error;
      }
      return decodeDmoWav(await response.arrayBuffer());
    },
  };
}
