export type BetLedgerFetchResult =
  | { kind: 'ready'; bets: unknown[] }
  | { kind: 'unauthorized' }
  | { kind: 'unavailable' }
  | { kind: 'aborted' };

type RetryPause = (signal: AbortSignal) => Promise<void>;

const BET_LEDGER_RETRY_DELAY_MS = 700;
const BET_LEDGER_MAX_ATTEMPTS = 2;

function pauseBeforeRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };

    timer = setTimeout(finish, BET_LEDGER_RETRY_DELAY_MS);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Retry a transient account-feed failure once before showing an error to the visitor. */
export async function fetchBetLedger(
  signal: AbortSignal,
  request: typeof fetch = fetch,
  waitBeforeRetry: RetryPause = pauseBeforeRetry,
): Promise<BetLedgerFetchResult> {
  for (let attempt = 0; attempt < BET_LEDGER_MAX_ATTEMPTS; attempt += 1) {
    if (signal.aborted) return { kind: 'aborted' };

    try {
      const response = await request('/api/betting/ledger', {
        cache: 'no-store',
        signal,
      });
      if (signal.aborted) return { kind: 'aborted' };
      if (response.status === 401) return { kind: 'unauthorized' };

      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        if (attempt === 0 && retryable) {
          await waitBeforeRetry(signal);
          continue;
        }
        return { kind: 'unavailable' };
      }

      const payload = await response.json() as { bets?: unknown } | null;
      if (signal.aborted) return { kind: 'aborted' };
      if (payload && Array.isArray(payload.bets)) {
        return { kind: 'ready', bets: payload.bets };
      }
      if (attempt === 0) {
        await waitBeforeRetry(signal);
        continue;
      }
      return { kind: 'unavailable' };
    } catch {
      if (signal.aborted) return { kind: 'aborted' };
      if (attempt === 0) {
        await waitBeforeRetry(signal);
        continue;
      }
      return { kind: 'unavailable' };
    }
  }

  return { kind: 'unavailable' };
}
