/** Retry the Core API's short-lived response while a pinned archive warms. */
export async function fetchNativeMotionAsset(
  url: string,
  init: RequestInit = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      cache: init.cache ?? 'force-cache',
    });
    const retryHeader = response.headers.get('Retry-After');
    const retryAfter = retryHeader ? Number(retryHeader) : Number.NaN;
    if (
      response.status !== 503
      || !Number.isFinite(retryAfter)
      || attempt >= 11
    ) {
      return response;
    }
    try {
      await response.body?.cancel();
    } catch {
      // The response body may already be closed by the browser.
    }
    await new Promise<void>((resolve, reject) => {
      const signal = init.signal;
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Request aborted.', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, Math.min(Math.max(retryAfter, 3) + attempt, 10) * 1000);
      if (signal?.aborted) {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Request aborted.', 'AbortError'));
      } else {
        signal?.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}
