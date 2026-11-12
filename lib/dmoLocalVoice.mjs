const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

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
