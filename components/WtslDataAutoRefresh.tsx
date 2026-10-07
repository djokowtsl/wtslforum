'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Refresh official WTSL match data while the visitor keeps a board open. */
export default function WtslDataAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [router]);

  return null;
}
