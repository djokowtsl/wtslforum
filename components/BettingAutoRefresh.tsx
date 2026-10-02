'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Refresh the server-rendered betting board after the bot's five-minute sync. */
export default function BettingAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [router]);

  return null;
}