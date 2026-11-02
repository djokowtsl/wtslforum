'use client';

import { useCallback, useEffect, type RefObject } from 'react';

export function useTe4ViewerTheme(frameRef: RefObject<HTMLIFrameElement | null>) {
  const syncTheme = useCallback(() => {
    const theme = document.documentElement.getAttribute('data-theme') === 'light'
      ? 'light'
      : 'dark';
    frameRef.current?.contentWindow?.postMessage({ type: 'set-theme', theme }, '*');
  }, [frameRef]);

  useEffect(() => {
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [syncTheme]);

  return syncTheme;
}
