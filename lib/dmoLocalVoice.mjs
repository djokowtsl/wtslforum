const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export function isDmoLocalVoiceDeviceSupported({
  userAgent = '',
  deviceMemory = null,
  maxTouchPoints = 0,
} = {}) {
  const mobileBrowser = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  const lowMemoryDevice = typeof deviceMemory === 'number' && deviceMemory <= 4;
  return !mobileBrowser && !lowMemoryDevice;
}

export function canUseDmoLocalVoice() {
  if (typeof navigator === 'undefined') return false;
  return isDmoLocalVoiceDeviceSupported({
    userAgent: navigator.userAgent || '',
    deviceMemory: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null,
    maxTouchPoints: navigator.maxTouchPoints || 0,
  });
}

/** @type {Promise<import('kokoro-js').KokoroTTS> | null} */
let modelPromise = null;

/**
 * Load the quantized Kokoro model in the browser on demand.
 *
 * @param {(progress: { status?: string; progress?: number; total?: number }) => void} [onProgress]
 * @returns {Promise<import('kokoro-js').KokoroTTS>}
 */
export function loadDmoLocalVoiceModel(onProgress) {
  if (!modelPromise) {
    modelPromise = import('kokoro-js')
      .then(({ KokoroTTS }) => KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: onProgress,
      }))
      .catch((error) => {
        modelPromise = null;
        throw error;
      });
  }
  return modelPromise;
}
