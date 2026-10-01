import Link from 'next/link';
import { getSession, discordAvatar } from '@/lib/auth';
import { MobileNav } from './MobileNav';
import { ThemeToggle } from './ThemeToggle';

export const NAV = [
  { href: '/discussions', label: 'Discussions' },
  { href: '/matches', label: 'Matches' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/players', label: 'Players' },
  { href: '/articles', label: 'Articles' },
  { href: '/awards', label: 'Awards' },
  { href: '/stats', label: 'Statistics' },
  { href: '/about', label: 'About' },
];

export async function ForumHeader() {
  const u = await getSession();
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="WTSL Community home">
          {/* Official WTSL logo */}
          <img className="brand-logo" src="/brand/wtsl-logo-200.png" alt="WTSL — World Tennis Simulation League" width={215} height={200} />
          <span className="brand-text">
            <b>COMMUNITY</b>
            <span>Forum &amp; Media Hub</span>
          </span>
        </Link>

        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}>{n.label}</Link>
          ))}
          {u?.isAdmin && <Link href="/admin">Admin</Link>}
          <ThemeToggle />
          {u ? (
            <Link href="/profile" className="user-chip">
              <img src={discordAvatar(u.avatar, u.username)} alt="" />
              {u.username}
            </Link>
          ) : (
            <a className="btn btn-discord btn-sm nav-cta" href="/api/auth/discord">Log in with Discord</a>
          )}
        </nav>

        <MobileNav
          items={NAV}
          isAdmin={!!u?.isAdmin}
          username={u?.username}
          discordJoinHref="/api/auth/discord"
        />
      </div>
    </header>
  );
}
