import { createDmoServerVoiceModel } from './dmoCommentarySpeech.mjs';
import { createDmoVoiceRouter, createDmoWorkerVoiceModel } from './dmoVoiceEngine.mjs';

export function isDmoLocalVoiceDeviceSupported({
  userAgent = '',
  maxTouchPoints = 0,
  allowMobile = true,
} = {}) {
  const mobileBrowser = isMobileDmoVoiceDevice({ userAgent, maxTouchPoints });
  return !mobileBrowser || allowMobile;
}

export function isMobileDmoVoiceDevice({
  userAgent = '',
  maxTouchPoints = 0,
} = {}) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

export function canUseDmoLocalVoice({ allowMobile = true } = {}) {
  if (typeof navigator === 'undefined') return false;
  return isDmoLocalVoiceDeviceSupported({
    userAgent: navigator.userAgent || '',
    maxTouchPoints: navigator.maxTouchPoints || 0,
    allowMobile,
  });
}

export function isMobileDmoLocalVoiceDevice() {
  if (typeof navigator === 'undefined') return false;
  return isMobileDmoVoiceDevice({
    userAgent: navigator.userAgent || '',
    maxTouchPoints: navigator.maxTouchPoints || 0,
  });
}

/** Short line used to prove a voice works before commentary relies on it. */
export const DMO_VOICE_WARMUP_TEXT = 'Ready.';
const SERVER_WARMUP_DEADLINE_MS = 45_000;

/** @type {Promise<ReturnType<typeof createDmoVoiceRouter>> | null} */
let voicePromise = null;

function withDeadline(work, milliseconds, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Resolve with the first source that succeeds; reject only if all fail. */
function firstFulfilled(entries) {
  return new Promise((resolve, reject) => {
    let failed = 0;
    const errors = [];
    entries.forEach(([name, work], index) => {
      work.then(
        (value) => resolve([name, value]),
        (error) => {
          errors[index] = error;
          failed += 1;
          if (failed === entries.length) reject(errors.find(Boolean));
        },
      );
    });
  });
}

async function startServerVoice(createServer) {
  const model = await createServer();
  await withDeadline(
    Promise.resolve(model.generate(DMO_VOICE_WARMUP_TEXT, { voice: 'af_heart' })),
    SERVER_WARMUP_DEADLINE_MS,
    'The WTSL commentary voice did not respond',
  );
  return model;
}

/**
 * Prepare the commentary voice. Call it when the viewer turns commentary on,
 * not when the page opens: it downloads a model and uses CPU.
 *
 * - Phones use the WTSL server's Kokoro only. Kokoro plus the 3D replay
 *   exceed a phone tab's memory, and the tab crashes.
 * - Desktops start local Kokoro in a Web Worker (off the render thread) and
 *   check the server voice at the same time. Commentary is ready as soon as
 *   either can speak: usually the server within seconds, while the local model
 *   downloads (about 92 MB, once) and then takes over.
 * - Local Kokoro never runs on the main thread. A browser without module
 *   workers uses the server voice only.
 *
 * Resolves to a Kokoro-compatible model with `generate()` and `prefetch()`.
 *
 * @param {(progress: { status?: string; progress?: number; total?: number; backend?: 'wasm' | 'server' }) => void} [onProgress]
 * @param {{
 *   serverOnly?: boolean,
 *   createServer?: () => { generate: Function } | Promise<{ generate: Function }>,
 *   createLocal?: (options: { onProgress?: Function }) => Promise<{ generate: Function }>,
 * }} [options]
 */
export function loadDmoLocalVoiceModel(onProgress, {
  serverOnly = isMobileDmoLocalVoiceDevice() || typeof Worker === 'undefined',
  createServer = () => createDmoServerVoiceModel(),
  createLocal = createDmoWorkerVoiceModel,
} = {}) {
  if (!voicePromise) {
    voicePromise = (async () => {
      if (serverOnly) {
        onProgress?.({ status: 'backend', backend: 'server' });
        onProgress?.({ status: 'warmup' });
        return createDmoVoiceRouter({ server: await startServerVoice(createServer) });
      }
      onProgress?.({ status: 'backend', backend: 'wasm' });
      let local;
      try {
        local = Promise.resolve(createLocal({ onProgress }));
      } catch (error) {
        local = Promise.reject(error);
      }
      const server = startServerVoice(createServer);
      local.catch(() => {});
      server.catch(() => {});
      // Rejects with the local cause only when neither voice can speak.
      await firstFulfilled([['local', local], ['server', server]]);
      return createDmoVoiceRouter({ server, local });
    })().catch((error) => {
      voicePromise = null;
      throw error;
    });
  }
  return voicePromise;
}

/** Forget the prepared voice (tests, or after the page stops using it). */
export function resetDmoLocalVoiceModel() {
  voicePromise = null;
}
