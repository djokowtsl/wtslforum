export function startBackgroundTicker(
  onTick: () => void,
  intervalMs: number,
  options?: {
    createWorker?: () => Worker | null;
    setInterval?: typeof globalThis.setInterval;
    clearInterval?: typeof globalThis.clearInterval;
  },
): () => void;
