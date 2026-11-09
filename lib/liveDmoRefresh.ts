import type { LiveBroadcastScore } from './liveBroadcastScore';

export const LIVE_DMO_REQUEST_TIMEOUT_MS = 5_000;
export const LIVE_DMO_SCORE_MAX_AGE_MS = 5_000;

export type ReceivedLiveScore = {
  score: LiveBroadcastScore | null;
  receivedAt: number;
};

export function freshLiveDmoScore(entry?: ReceivedLiveScore, now = Date.now()) {
  return entry && now - entry.receivedAt < LIVE_DMO_SCORE_MAX_AGE_MS
    ? entry.score
    : null;
}

// Bound both the request and body read; a stalled response must not keep the
// poller's single-flight guard locked indefinitely.
export async function fetchLiveDmoJson(url: string, signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, LIVE_DMO_REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(typeof body?.error === 'string'
        ? body.error
        : `Live feed unavailable (${response.status}).`);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('The live feed returned an invalid response.');
    }
    return { body, durationMs: Math.round(performance.now() - startedAt) };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
