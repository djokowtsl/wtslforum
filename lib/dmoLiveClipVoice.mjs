/**
 * The live-match commentary voice for viewers: stored clips.
 *
 * Instead of running a speech model on the device, each line is fetched as an
 * MP3 from the broadcast's commentary store (pre-made for common lines, made
 * once on first use for the rest) and decoded. It has the same `generate()`
 * shape as Kokoro, so the booth's timing and playback are unchanged.
 */

import { createDmoVoiceRouter } from './dmoVoiceEngine.mjs';

const clipUrl = (broadcastId, voice, text) => (
  `/api/live-dmo/${encodeURIComponent(broadcastId)}/commentary/clip?${new URLSearchParams({ voice, text })}`
);

/**
 * @param {{
 *   broadcastId: string,
 *   decode: (bytes: ArrayBuffer) => Promise<{ getChannelData(channel: number): Float32Array, sampleRate: number }>,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export function createDmoLiveClipVoice({ broadcastId, decode, fetchImpl = (...args) => fetch(...args) }) {
  return {
    dmoVoiceSource: 'server',
    async generate(text, { voice = 'af_heart' } = {}) {
      const response = await fetchImpl(clipUrl(broadcastId, voice, String(text ?? '').trim()));
      if (!response.ok) {
        const error = new Error(`Live commentary clip returned ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const decoded = await decode(await response.arrayBuffer());
      return { audio: decoded.getChannelData(0), sampling_rate: decoded.sampleRate };
    },
  };
}

/**
 * Check the broadcast's commentary is reachable, then return a cached,
 * prefetch-capable voice built on its clips.
 */
export async function loadDmoLiveClipVoice(options) {
  const fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  const response = await fetchImpl(`/api/live-dmo/${encodeURIComponent(options.broadcastId)}/commentary`);
  if (!response.ok) {
    const error = new Error(`Live commentary returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return createDmoVoiceRouter({ server: createDmoLiveClipVoice({ ...options, fetchImpl }) });
}
