/**
 * Commentary voice engine: where each spoken line comes from.
 *
 * - Local Kokoro runs in a Web Worker (dmoKokoroWorker.mjs), never on the
 *   page's main thread, so generating speech cannot freeze the 3D replay.
 * - Until the local model has downloaded and warmed up, or if it cannot run,
 *   lines come from the WTSL server's Kokoro instead, so commentary can start
 *   within seconds rather than after a 92 MB download.
 * - Every line is cached by text and voice, and upcoming lines can be fetched
 *   before they are needed, so most calls play the moment a point ends.
 */

const DEFAULT_CACHE_ENTRIES = 32;

function defaultCreateWorker() {
  return new Worker(new URL('./dmoKokoroWorker.mjs', import.meta.url), {
    type: 'module',
    name: 'wtsl-commentary-voice',
  });
}

/**
 * Start Kokoro in a worker. Resolves to a Kokoro-compatible model once the
 * worker has loaded the model and spoken a warm-up line.
 */
export function createDmoWorkerVoiceModel({ onProgress, createWorker = defaultCreateWorker } = {}) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = createWorker();
    } catch (error) {
      reject(error);
      return;
    }
    let nextId = 1;
    let ready = false;
    let broken = null;
    const pending = new Map();

    const failAll = (error) => {
      broken = error;
      for (const { reject: rejectJob } of pending.values()) rejectJob(error);
      pending.clear();
    };

    const model = {
      dmoVoiceSource: 'local',
      generate(text, { voice = 'af_heart', speed = 1.03, priority = 'high' } = {}) {
        if (broken) return Promise.reject(broken);
        const id = nextId++;
        return new Promise((resolveJob, rejectJob) => {
          pending.set(id, { resolve: resolveJob, reject: rejectJob });
          worker.postMessage({ type: 'generate', id, text, voice, speed, priority });
        });
      },
      terminate() {
        failAll(new Error('The commentary voice was stopped'));
        worker.terminate?.();
      },
    };

    worker.addEventListener('message', (event) => {
      const message = event.data ?? {};
      if (message.type === 'progress') onProgress?.(message.progress ?? {});
      else if (message.type === 'ready') {
        ready = true;
        resolve(model);
      } else if (message.type === 'load-error') {
        const error = new Error(message.message || 'Kokoro could not load');
        failAll(error);
        worker.terminate?.();
        if (!ready) reject(error);
      } else if (message.type === 'audio' || message.type === 'error') {
        const job = pending.get(message.id);
        if (!job) return;
        pending.delete(message.id);
        if (message.type === 'audio') job.resolve({ audio: message.audio, sampling_rate: message.sampling_rate });
        else job.reject(new Error(message.message || 'Kokoro could not generate speech'));
      }
    });
    worker.addEventListener('error', (event) => {
      const error = new Error(event?.message || 'The commentary voice worker stopped');
      failAll(error);
      if (!ready) reject(error);
    });
    worker.postMessage({ type: 'load' });
  });
}

/**
 * One Kokoro-compatible model that serves each line from the cache, the local
 * worker when it is ready, or the server voice while it is not.
 *
 * @param {{
 *   server?: { generate: Function } | null,
 *   local?: Promise<{ generate: Function } | null> | null,
 *   cacheEntries?: number,
 * }} sources
 */
export function createDmoVoiceRouter({ server = null, local = null, cacheEntries = DEFAULT_CACHE_ENTRIES } = {}) {
  const isPromise = (value) => Boolean(value) && typeof value.then === 'function';
  let serverModel = isPromise(server) ? null : server;
  let localModel = isPromise(local) ? null : local;
  let localPending = isPromise(local);
  const serverReady = Promise.resolve(server).then(
    (model) => (serverModel = model ?? null),
    () => null,
  );
  const localReady = Promise.resolve(local).then(
    (model) => {
      localModel = model ?? null;
      localPending = false;
      return localModel;
    },
    () => {
      localPending = false;
      return null;
    },
  );
  const cache = new Map();

  async function produce(text, options) {
    if (localModel) {
      try {
        return await localModel.generate(text, options);
      } catch (error) {
        const fallback = serverModel ?? await serverReady;
        if (!fallback) throw error;
        return fallback.generate(text, options);
      }
    }
    if (serverModel) {
      try {
        return await serverModel.generate(text, options);
      } catch (error) {
        if (!localPending) throw error;
      }
    }
    const model = await localReady;
    if (model) return model.generate(text, options);
    const fallback = await serverReady;
    if (fallback) return fallback.generate(text, options);
    throw new Error('No commentary voice is available');
  }

  function generate(text, options = {}) {
    const key = `${options.voice ?? 'af_heart'}|${options.speed ?? ''}|${text}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached;
    }
    const work = produce(text, options);
    cache.set(key, work);
    work.catch(() => {
      if (cache.get(key) === work) cache.delete(key);
    });
    while (cache.size > cacheEntries) cache.delete(cache.keys().next().value);
    return work;
  }

  return {
    get dmoVoiceSource() {
      return localModel ? 'local' : 'server';
    },
    generate,
    /** Prepare a line before it is needed; failures are ignored until it is. */
    prefetch(text, options = {}) {
      generate(text, { ...options, priority: 'low' }).catch(() => {});
    },
  };
}
