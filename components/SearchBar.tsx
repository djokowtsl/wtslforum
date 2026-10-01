'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Site-wide search box — submits to /search?q=... which looks across discussions, articles,
 * players and tournaments. Used in both the desktop header and the mobile menu. */
export function SearchBar({ className = '', onNavigate }: { className?: string; onNavigate?: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    router.push(`/search?q=${encodeURIComponent(query)}`);
    onNavigate?.();
  }

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
