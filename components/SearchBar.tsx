'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/** Site-wide search box — submits to /search?q=... which looks across discussions, articles,
 * players and tournaments. Used in the desktop and mobile headers.
 *
 * `compact` renders as a small icon button that expands into the input on click — used in the
 * desktop header where the nav already has 13+ links and a permanently-expanded input would
 * squeeze/overflow it. The mobile header uses the same compact control so search stays in place. */
export function SearchBar({ className = '', onNavigate, compact = false }: { className?: string; onNavigate?: () => void; compact?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(!compact);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!compact || !open) return;
    function onDocClick(e: MouseEvent) {
      if (formRef.current && !formRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [compact, open]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    router.push(`/search?q=${encodeURIComponent(query)}`);
    onNavigate?.();
    if (compact) setOpen(false);
  }

  if (!compact) {
    return (
      <form className={`search-bar ${className}`} role="search" onSubmit={submit}>
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the forum…"
          aria-label="Search the forum"
        />
        <button type="submit" aria-label="Search">🔍</button>
      </form>
    );
  }

  // Compact mode wraps everything in one self-contained, positioned box so the expanded form
  // drops down over the page instead of pushing the nav links around.
  return (
    <div className={`search-wrap ${className}`}>
      {!open ? (
        <button type="button" className="search-toggle" aria-label="Search" onClick={() => setOpen(true)}>🔍</button>
      ) : (
        <form ref={formRef} className="search-bar search-bar-compact" role="search" onSubmit={submit}>
          <input
            type="search"
            name="q"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the forum…"
            aria-label="Search the forum"
          />
          <button type="submit" aria-label="Search">🔍</button>
        </form>
      )}
    </div>
  );
}
