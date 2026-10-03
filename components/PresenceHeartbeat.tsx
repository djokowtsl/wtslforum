'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const HEARTBEAT_INTERVAL_MS = 60_000;

export default function PresenceHeartbeat() {
  const router = useRouter();

  useEffect(() => {
    let active = false;
    const heartbeat = () => {
      if (document.visibilityState !== 'visible') {
        active = false;
        return;
      }
      const becameActive = !active;
      active = true;
      void fetch('/api/profile/presence', {
        method: 'POST',
        cache: 'no-store',
        keepalive: true,
      }).then((response) => {
        if (response.ok && becameActive) router.refresh();
      }).catch(() => {});
    };

    heartbeat();
    const interval = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener('visibilitychange', heartbeat);
    window.addEventListener('focus', heartbeat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', heartbeat);
      window.removeEventListener('focus', heartbeat);
    };
  }, [router]);

  return null;
}