import Link from 'next/link';
import { canModerateComments, getSession, discordAvatar } from '@/lib/auth';
import { safe } from '@/lib/db';
import { getUserStatus } from '@/lib/presence';
import { unreadMessageCount } from '@/lib/messages';
import { MobileNav } from './MobileNav';
import { ThemeToggle } from './ThemeToggle';
import { StatusDot } from './StatusDot';
import { SearchBar } from './SearchBar';

export const NAV = [
  { href: '/discussions', label: 'Discussions' },
  { href: '/matches', label: 'Matches' },
  { href: '/betting', label: 'Betting' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/players', label: 'Players' },
  { href: '/articles', label: 'Articles' },
  { href: '/media', label: 'Media' },
  { href: '/awards', label: 'Awards' },
  { href: '/stats', label: 'Statistics' },
  { href: '/screenshot-stats', label: 'Screenshot Data' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/predictions', label: 'Predictions' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/about', label: 'About' },
];

export async function ForumHeader() {
  const u = await getSession();
  const canModerate = canModerateComments(u);
  const status = u ? await safe(() => getUserStatus(u.id), 'online' as const) : null;
  const unread = u ? await safe(() => unreadMessageCount(u.id), 0) : 0;
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="WTSL Forum home">
          {/* Official WTSL logo */}
          <img className="brand-logo" src="/brand/wtsl-logo-200.png" alt="WTSL — World Tennis Simulation League" width={215} height={200} />
          <span className="brand-text">
            <b>FORUM</b>
            <span>Community &amp; Media Hub</span>
          </span>
        </Link>

        <SearchBar className="header-search" compact />

        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}>{n.label}</Link>
          ))}
          {u?.isAdmin && <Link href="/admin">Admin</Link>}
          {canModerate && <Link href="/admin/moderation">Moderation</Link>}
          {u && (
            <Link href="/messages" className="nav-messages">
              Chat{unread > 0 && <span className="pill red nav-badge">{unread}</span>}
            </Link>
          )}
          {u ? (
            <Link href="/profile" className="user-chip">
              <img src={discordAvatar(u.avatar, u.username)} alt="" />
              <StatusDot status={status} />
              {u.username}
            </Link>
          ) : (
            <a className="btn btn-discord btn-sm nav-cta" href="/api/auth/discord">Log in with Discord</a>
          )}
        </nav>

        <div className="header-theme-toggle"><ThemeToggle /></div>
        <MobileNav
          items={NAV}
          isAdmin={!!u?.isAdmin}
          canModerate={canModerate}
          username={u?.username}
          discordJoinHref="/api/auth/discord"
          unreadMessages={unread}
        />
      </div>
    </header>
  );
}
