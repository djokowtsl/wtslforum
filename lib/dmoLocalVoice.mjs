const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export function isDmoLocalVoiceDeviceSupported({
  userAgent = '',
  deviceMemory = null,
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
    deviceMemory: typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null,
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

/**
 * Load the quantized Kokoro model in the browser on demand.
 *
 * @param {(progress: { status?: string; progress?: number; total?: number; backend?: 'webgpu' | 'wasm' }) => void} [onProgress]
 * @returns {Promise<import('kokoro-js').KokoroTTS>}
 */
export function loadDmoLocalVoiceModel(onProgress) {
  if (!modelPromise) {
    modelPromise = import('kokoro-js')
      .then(async ({ KokoroTTS }) => {
        let adapter = null;
        try {
          if (typeof navigator !== 'undefined' && navigator.gpu?.requestAdapter) {
            adapter = await navigator.gpu.requestAdapter();
          }
        } catch { /* WebGPU is optional; keep using Kokoro on WASM. */ }
        if (adapter) {
          onProgress?.({ status: 'backend', backend: 'webgpu' });
          try {
            return await KokoroTTS.from_pretrained(MODEL_ID, {
              dtype: 'q8',
              device: 'webgpu',
              progress_callback: onProgress,
            });
          } catch {
            onProgress?.({ status: 'backend-fallback', backend: 'wasm' });
          }
        }
        onProgress?.({ status: 'backend', backend: 'wasm' });
        return KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: onProgress,
        });
      })
      .catch((error) => {
        modelPromise = null;
        throw error;
      });
  }
  return modelPromise;
}
