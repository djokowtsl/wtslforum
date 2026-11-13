/**
 * Kokoro speech in a Web Worker.
 *
 * Generating a line takes seconds of CPU. On the page's main thread that work
 * blocks the 3D replay's render loop, so playback freezes while each call is
 * prepared. Here it runs on its own thread; the page only receives finished
 * audio.
 *
 * Messages in:  { type: 'load' }
 *               { type: 'generate', id, text, voice, speed, priority: 'high' | 'low' }
 * Messages out: { type: 'progress', progress }
 *               { type: 'ready' } | { type: 'load-error', message }
 *               { type: 'audio', id, audio: Float32Array, sampling_rate }
 *               { type: 'error', id, message }
 */

export const DMO_KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const WARMUP_TEXT = 'Ready.';

/**
 * The worker's behaviour, separated from `self` so it can be tested.
 * @param {{ post: (message: unknown, transfer?: Transferable[]) => void, importKokoro?: () => Promise<any> }} options
 */
export function createDmoKokoroWorkerHandler({
  post,
  importKokoro = () => import('kokoro-js'),
}) {
  let modelPromise = null;
  const queue = [];
  let busy = false;

  const describe = (error) => String(error instanceof Error ? error.message : error).slice(0, 200);

  function load() {
    if (!modelPromise) {
      modelPromise = importKokoro()
        .then(async ({ KokoroTTS }) => {
          const model = await KokoroTTS.from_pretrained(DMO_KOKORO_MODEL_ID, {
            // The compact q8 weights belong on WASM; on WebGPU they crawl.
            dtype: 'q8',
            device: 'wasm',
            progress_callback: (progress) => post({
              type: 'progress',
              progress: {
                status: progress?.status,
                progress: progress?.progress,
                total: progress?.total,
              },
            }),
          });
          post({ type: 'progress', progress: { status: 'warmup' } });
          await model.generate(WARMUP_TEXT, { voice: 'af_heart' });
          return model;
        });
      modelPromise.then(
        () => post({ type: 'ready' }),
        (error) => {
          modelPromise = null;
          post({ type: 'load-error', message: describe(error) });
        },
      );
    }
    return modelPromise;
  }

  async function pump() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const job = queue.shift();
        try {
          const model = await load();
          const result = await model.generate(job.text, { voice: job.voice, speed: job.speed });
          // Copy into a buffer this message can own, then hand it over without
          // a second copy.
          const audio = new Float32Array(result.audio);
          post({ type: 'audio', id: job.id, audio, sampling_rate: result.sampling_rate }, [audio.buffer]);
        } catch (error) {
          post({ type: 'error', id: job.id, message: describe(error) });
        }
      }
    } finally {
      busy = false;
    }
  }

  return function handle(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'load') {
      load().catch(() => {});
      return;
    }
    if (message.type === 'generate') {
      // A line that is about to be heard goes ahead of lines fetched early.
      if (message.priority === 'high') {
        const firstLow = queue.findIndex((job) => job.priority !== 'high');
        queue.splice(firstLow === -1 ? queue.length : firstLow, 0, message);
      } else {
        queue.push(message);
      }
      void pump();
    }
  };
}

// Running as a worker: wire the handler to the worker's message port.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function'
  && typeof window === 'undefined') {
  const handle = createDmoKokoroWorkerHandler({
    post: (message, transfer) => self.postMessage(message, transfer ?? []),
  });
  self.addEventListener('message', (event) => handle(event.data));
}
