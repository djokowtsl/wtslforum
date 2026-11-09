import type { LiveBroadcastScore } from './liveBroadcastScore';

export const LIVE_DMO_REQUEST_TIMEOUT_MS = 5_000;
export const LIVE_DMO_SCORE_MAX_AGE_MS = 5_000;
export const LIVE_DMO_POINT_BATCH_SIZE = 100;

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
export async function fetchLiveDmoResponse(
  url: string,
  signal: AbortSignal,
  init: RequestInit = {},
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, LIVE_DMO_REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await response.json();
    return { response, body, durationMs: Math.round(performance.now() - startedAt) };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export async function fetchLiveDmoJson(
  url: string,
  signal: AbortSignal,
  init: RequestInit = {},
) {
  const { response, body, durationMs } = await fetchLiveDmoResponse(url, signal, init);
  if (!response.ok) {
    const error = new Error(typeof body?.error === 'string'
      ? body.error
      : `Live feed unavailable (${response.status}).`);
    Object.assign(error, { status: response.status, responseBody: body });
    throw error;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('The live feed returned an invalid response.');
  }
  return { body, durationMs };
}

export function reconcileLiveDmoSequence(
  currentSequence: number,
  proposedSequence: number,
  status: number,
  body: unknown,
): { sequence: number; acknowledged: boolean } | null {
  const responseBody = body && typeof body === 'object'
    ? body as Record<string, unknown>
    : {};
  if (status >= 200 && status < 300) {
    const acknowledgedSequence = responseBody.sequence;
    if (
      acknowledgedSequence !== undefined
      && (!Number.isSafeInteger(acknowledgedSequence) || Number(acknowledgedSequence) < proposedSequence)
    ) return null;
    return {
      sequence: Math.max(
        currentSequence,
        acknowledgedSequence === undefined ? proposedSequence : Number(acknowledgedSequence),
      ),
      acknowledged: true,
    };
  }
  const currentServerSequence = responseBody.currentSequence;
  if (
    status === 409
    && Number.isSafeInteger(currentServerSequence)
    && Number(currentServerSequence) >= proposedSequence
  ) {
    return {
      sequence: Math.max(currentSequence, Number(currentServerSequence)),
      acknowledged: false,
    };
  }
  return null;
}

export async function uploadLiveDmoPointHistory(
  url: string,
  points: unknown[],
  signal: AbortSignal,
): Promise<void> {
  for (let offset = 0; offset < points.length; offset += LIVE_DMO_POINT_BATCH_SIZE) {
    await fetchLiveDmoJson(url, signal, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: points.slice(offset, offset + LIVE_DMO_POINT_BATCH_SIZE),
      }),
    });
  }
}
