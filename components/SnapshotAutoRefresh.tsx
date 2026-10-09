'use client';

import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const SNAPSHOT_REFRESH_INTERVAL_MS = 300_000;

/** Re-read server-rendered public snapshots periodically without blocking the page. */
export default function SnapshotAutoRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !isPending) {
        startTransition(() => router.refresh());
      }
    };
    const timer = window.setInterval(refresh, SNAPSHOT_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [router, isPending]);

  return null;
}
