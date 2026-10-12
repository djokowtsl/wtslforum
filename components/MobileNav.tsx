'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

type NavItem = { href: string; label: string };

export function MobileNav({
  items,
  isAdmin,
  canModerate,
  username,
  profileAvatar,
  discordJoinHref,
  unreadMessages = 0,
}: {
  items: NavItem[];
  isAdmin: boolean;
  canModerate: boolean;
  username?: string;
  profileAvatar?: string;
  discordJoinHref: string;
  unreadMessages?: number;
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
        {canModerate && <Link href="/admin/moderation" onClick={close}>Moderation</Link>}
        {username && (
          <Link href="/messages" onClick={close}>
            Chat{unreadMessages > 0 && <span className="pill red nav-badge">{unreadMessages}</span>}
          </Link>
        )}
        {username ? (
          <Link href="/profile" className="btn btn-ghost mobile-profile-link" onClick={close}>
            {profileAvatar && <img src={profileAvatar} alt="" />}
            <span>{username}</span>
          </Link>
        ) : (
          <a className="btn btn-discord" href={discordJoinHref} onClick={close}>Log in with Discord</a>
        )}
      </div>
    </details>
  );
}
