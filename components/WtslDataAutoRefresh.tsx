'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const LIVE_DATA_REFRESH_INTERVAL_MS = 15_000;

/** Refresh official WTSL match data while the visitor keeps a board open. */
export default function WtslDataAutoRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !isPending) {
        startTransition(() => router.refresh());
      }
    }, LIVE_DATA_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [router, isPending]);

  return null;
}
