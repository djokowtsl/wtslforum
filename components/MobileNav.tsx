'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

type NavItem = { href: string; label: string };

export function MobileNav({
  items,
  isAdmin,
  username,
  discordJoinHref,
}: {
  items: NavItem[];
  isAdmin: boolean;
  username?: string;
  discordJoinHref: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  // Close the mobile menu whenever the route changes, since Next.js client-side
  // navigation keeps the <details> element mounted (and thus open) across pages.
  useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = false;
  }, [pathname]);

  function close() {
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <details className="mobile-menu" ref={detailsRef}>
      <summary aria-label="Open menu"><span className="burger" /></summary>
      <div className="mobile-panel">
        {items.map((n) => (
          <Link key={n.href} href={n.href} onClick={close}>{n.label}</Link>
        ))}
        {isAdmin && <Link href="/admin" onClick={close}>Admin</Link>}
        {username ? (
          <Link href="/profile" className="btn btn-ghost" onClick={close}>{username}</Link>
        ) : (
          <a className="btn btn-discord" href={discordJoinHref} onClick={close}>Log in with Discord</a>
        )}
      </div>
    </details>
  );
}
