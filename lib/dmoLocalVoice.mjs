const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

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

/** @type {Promise<import('kokoro-js').KokoroTTS> | null} */
let modelPromise = null;
/** @type {Promise<{ generate: Function; dmoVoiceSource: 'server' }> | null} */
let serverModelPromise = null;

export const DMO_VOICE_WARMUP_TEXT = 'Ready.';
const WARMUP_DEADLINE_MS = 120_000;

function withDeadline(work, milliseconds, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), milliseconds);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function warmUp(model, label) {
  if (typeof model?.generate !== 'function') return model;
  await withDeadline(
    Promise.resolve(model.generate(DMO_VOICE_WARMUP_TEXT, { voice: 'af_heart' })),
    WARMUP_DEADLINE_MS,
    `${label} warm-up timed out`,
  );
  return model;
}

/** Use the WTSL server's Kokoro when a phone cannot safely host the model. */
export function loadDmoServerVoiceModel(onProgress) {
  if (!serverModelPromise) {
    onProgress?.({ status: 'backend', backend: 'server' });
    serverModelPromise = import('./dmoCommentarySpeech.mjs')
      .then(async ({ createDmoServerVoiceModel }) => {
        const model = createDmoServerVoiceModel();
        onProgress?.({ status: 'warmup' });
        return warmUp(model, 'Commentary voice server');
      })
      .catch((error) => {
        serverModelPromise = null;
        throw error;
      });
  }
  return serverModelPromise;
}

/**
 * Load Kokoro on demand. Phones use the bot's server-side Kokoro; desktops use
 * the compact q8 WASM model. If local loading or warm-up fails, try the server.
 *
 * @param {(progress: { status?: string; progress?: number; total?: number; backend?: 'wasm' | 'server' }) => void} [onProgress]
 * @param {{ useServer?: boolean }} [options]
 * @returns {Promise<import('kokoro-js').KokoroTTS | { generate: Function; dmoVoiceSource: 'server' }>}
 */
export function loadDmoLocalVoiceModel(onProgress, { useServer = isMobileDmoLocalVoiceDevice() } = {}) {
  if (useServer) return loadDmoServerVoiceModel(onProgress);
  if (!modelPromise) {
    modelPromise = import('kokoro-js')
      .then(async ({ KokoroTTS }) => {
        onProgress?.({ status: 'backend', backend: 'wasm' });
        const model = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: onProgress,
        });
        onProgress?.({ status: 'warmup' });
        return warmUp(model, 'Kokoro');
      })
      .catch(async (localError) => {
        modelPromise = null;
        onProgress?.({ status: 'backend-fallback', backend: 'server' });
        try {
          return await loadDmoServerVoiceModel(onProgress);
        } catch {
          // Report the local cause, which is the issue the viewer can act on.
          throw localError;
        }
      });
  }
  return modelPromise;
}
