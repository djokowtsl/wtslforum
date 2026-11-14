/**
 * Drive the live host's upload and file-discovery ticks from a dedicated worker
 * instead of a background page timer. Browsers may still suspend a whole page;
 * this mitigates timer throttling, not OS sleep or browser tab discarding.
 *
 * @param {() => void} onTick
 * @param {number} intervalMs
 * @param {{ createWorker?: () => Worker | null, setInterval?: typeof globalThis.setInterval, clearInterval?: typeof globalThis.clearInterval }} [options]
 * @returns {() => void}
 */
export function startBackgroundTicker(onTick, intervalMs, options = {}) {
  const createWorker = options.createWorker ?? defaultWorker;
  const setTimer = options.setInterval ?? globalThis.setInterval.bind(globalThis);
  const clearTimer = options.clearInterval ?? globalThis.clearInterval.bind(globalThis);
  let stopped = false;
  let worker = null;
  let fallback = null;
  const startFallback = () => {
    if (stopped || fallback !== null) return;
    fallback = setTimer(() => { if (!stopped) onTick(); }, intervalMs);
  };
  try {
    worker = createWorker();
    if (worker) {
      worker.onmessage = () => { if (!stopped) onTick(); };
      worker.onerror = () => {
        if (stopped || !worker) return;
        worker.terminate();
        worker = null;
        startFallback();
      };
      worker.postMessage(intervalMs);
    }
  } catch {
    worker?.terminate();
    worker = null;
  }
  if (!worker) startFallback();
  return () => {
    stopped = true;
    if (worker) {
      worker.terminate();
      worker = null;
    }
    if (fallback !== null) clearTimer(fallback);
    fallback = null;
  };
}

function defaultWorker() {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./backgroundTickerWorker.mjs', import.meta.url), { type: 'module' });
}
