'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('wtsl-theme', theme); } catch { /* storage unavailable, theme just won't persist */ }
}

export function ThemeToggle() {
  // Starts null so the server-rendered markup matches the client's first render;
  // the real value is read from the DOM attribute the bootstrap script already set.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = (document.documentElement.getAttribute('data-theme') as Theme | null) || 'dark';
    setTheme(current);
  }, []);

  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label="Toggle light and dark theme">
      {theme === 'light' ? (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 4V2m0 20v-2M4 12H2m20 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4M5.6 18.4 4.2 19.8M19.8 4.2l-1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" /></svg>
      )}
    </button>
  );
}

/** Inline script rendered in <head> so the theme attribute is set before first paint (no flash). */
export function ThemeBootstrapScript() {
  const code = `(function(){try{var t=localStorage.getItem('wtsl-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
