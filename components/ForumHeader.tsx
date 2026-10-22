import Link from 'next/link';
import { canModerateComments, getSession, discordAvatar } from '@/lib/auth';
import { safe } from '@/lib/db';
import { getUserStatus } from '@/lib/presence';
import { unreadMessageCount } from '@/lib/messages';
import { MobileNav } from './MobileNav';
import { ThemeToggle } from './ThemeToggle';
import { StatusDot } from './StatusDot';
import { SearchBar } from './SearchBar';
import PresenceHeartbeat from './PresenceHeartbeat';

export const NAV = [
  { href: '/discussions', label: 'Discussions' },
  { href: '/matches', label: 'Matches' },
  { href: '/betting', label: 'Virtual Betting' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/players', label: 'Players' },
  { href: '/characters', label: 'Characters' },
  { href: '/articles', label: 'Articles' },
  { href: '/media', label: 'Media' },
  { href: '/livestreams', label: 'Live Streams' },
  { href: '/awards', label: 'Awards' },
  { href: '/stats', label: 'Statistics' },
  { href: '/screenshot-stats', label: 'Screenshot Data' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/predictions', label: 'Predictions & Projections' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/about', label: 'About' },
];

export async function ForumHeader() {
  const u = await getSession();
  const navItems = NAV;
  const canModerate = canModerateComments(u);
  const status = u ? await safe(() => getUserStatus(u.id), 'offline' as const) : null;
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

        <div className="header-actions">
          {u && (
            <Link href="/profile" className="header-user-chip" title={u.username}>
              <img src={discordAvatar(u.avatar, u.username)} alt="" />
              <StatusDot status={status} />
              <span className="user-chip-name">{u.username}</span>
            </Link>
          )}
          <div className="header-theme-toggle"><ThemeToggle /></div>
          <MobileNav
            items={navItems}
            isAdmin={!!u?.isAdmin}
            canModerate={canModerate}
            username={u?.username}
            profileAvatar={u ? discordAvatar(u.avatar, u.username) : undefined}
            discordJoinHref="/api/auth/discord"
            unreadMessages={unread}
          />
        </div>
      </div>
      <nav className="desktop-nav" aria-label="Main">
        <div className="desktop-nav-inner">
          <div className="desktop-nav-links">
            {navItems.map((n) => (
              <Link key={n.href} href={n.href}>{n.label}</Link>
            ))}
          </div>
          <div className="desktop-nav-utility">
            {u?.isAdmin && <Link href="/admin">Admin</Link>}
            {canModerate && <Link href="/admin/moderation">Moderation</Link>}
            {u && (
              <Link href="/messages" className="nav-messages">
                Chat{unread > 0 && <span className="pill red nav-badge">{unread}</span>}
              </Link>
            )}
            {!u && (
              <a className="btn btn-discord btn-sm nav-cta" href="/api/auth/discord">
                Log in with Discord
              </a>
            )}
          </div>
        </div>
      </nav>
      {u && <PresenceHeartbeat />}
    </header>
  );
}
