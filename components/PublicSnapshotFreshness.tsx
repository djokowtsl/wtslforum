'use client';

import { useEffect, useState } from 'react';

type RefreshState = 'loading' | 'ready' | 'unavailable';
type RefreshStatusPayload = { lastRefreshedAt: string | null };

const REFRESH_STATUS_POLL_INTERVAL_MS = 300_000;

export default function PublicSnapshotFreshness() {
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [state, setState] = useState<RefreshState>('loading');

  useEffect(() => {
    let active = true;
    let loading = false;

    const load = async () => {
      if (loading || document.visibilityState === 'hidden') return;
      loading = true;
      try {
        const response = await fetch('/api/public-page-snapshot-status', { cache: 'no-store' });
        if (!response.ok) throw new Error('Snapshot refresh status is unavailable');
        const payload = await response.json() as RefreshStatusPayload;
        if (payload.lastRefreshedAt !== null && typeof payload.lastRefreshedAt !== 'string') {
          throw new Error('Snapshot refresh status is invalid');
        }
        if (active) {
          const parsed = payload.lastRefreshedAt ? new Date(payload.lastRefreshedAt) : null;
          if (parsed && !Number.isFinite(parsed.getTime())) {
            throw new Error('Snapshot refresh timestamp is invalid');
          }
          setLastRefreshedAt(parsed?.toISOString() ?? null);
          setState('ready');
        }
      } catch {
        if (active) {
          setState((current) => current === 'ready' ? current : 'unavailable');
        }
      } finally {
        loading = false;
      }
    };

    void load();
    const timer = window.setInterval(() => { void load(); }, REFRESH_STATUS_POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
    };
  }, []);

  let message: string;
  if (state === 'loading') {
    message = 'Last full public-data snapshot refresh: checking…';
  } else if (state === 'unavailable') {
    message = 'Last full public-data snapshot refresh time is unavailable.';
  } else if (lastRefreshedAt) {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZoneName: 'short',
    }).format(new Date(lastRefreshedAt));
    message = `Last full public-data snapshot refresh: ${formatted}. Live panels may update sooner while you browse.`;
  } else {
    message = 'No successful full public-data snapshot refresh has completed yet.';
  }

  return <small className="footer-data-freshness" role="status" aria-live="polite">{message}</small>;
}
