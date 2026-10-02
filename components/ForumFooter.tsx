import Link from 'next/link';

export function ForumFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <img className="footer-logo" src="/brand/wtsl-logo-200.png" alt="WTSL — World Tennis Simulation League" width={215} height={200} />
          <p>
            <a
              className="footer-site-link"
              href="https://www.playwtsl.com/TE4"
              target="_blank"
              rel="noreferrer"
            >
              The community home of the World Tennis Simulation League
            </a>
          </p>
          <div className="footer-social">
            <a href="https://discord.com/invite/YkPAtGMUrj" target="_blank" rel="noreferrer" aria-label="WTSL Discord">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.6 3a.1.1 0 0 0-.1 0 13.6 13.6 0 0 0-.6 1.3 18.3 18.3 0 0 0-5.6 0A13 13 0 0 0 8.7 3a.1.1 0 0 0-.1-.1 19.7 19.7 0 0 0-4.7 1.5.1.1 0 0 0 0 0C1 9 .3 13.5.6 17.9a.1.1 0 0 0 0 .1 19.9 19.9 0 0 0 6 3 .1.1 0 0 0 .1 0 14.2 14.2 0 0 0 1.2-2 .1.1 0 0 0-.1-.2 13.1 13.1 0 0 1-1.9-.9.1.1 0 0 1 0-.2l.4-.3a.1.1 0 0 1 .1 0 14.2 14.2 0 0 0 12.1 0 .1.1 0 0 1 .1 0l.4.3a.1.1 0 0 1 0 .2 12.3 12.3 0 0 1-1.9.9.1.1 0 0 0-.1.2 16 16 0 0 0 1.3 2 .1.1 0 0 0 .1 0 19.8 19.8 0 0 0 6-3 .1.1 0 0 0 0-.1c.4-5.1-.6-9.6-2.9-13.5a.1.1 0 0 0 0 0ZM8.5 15.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.9.9 1.8 2c0 1.1-.8 2-1.8 2Zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2c0 1.1-.8 2-1.8 2Z" /></svg>
            </a>
            <a href="https://91d510368cb4170cd5ac3776.challonge.com/" target="_blank" rel="noreferrer" aria-label="WTSL Challonge">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 2h10v4a5 5 0 0 1-4 4.9V13h2v2H9v-2h2v-2.1A5 5 0 0 1 7 6V2Zm-4 2h3v2a3 3 0 0 0 2 2.8V7H5a2 2 0 0 1-2-2V4Zm18 0h-3v2a3 3 0 0 1-2 2.8V7h3a2 2 0 0 0 2-2V4ZM7 17h10v2H7v-2Zm-2 3h14v2H5v-2Z" /></svg>
            </a>
            <a href="https://mod.io/g/tennis-elbow-4/m/wtsl#description" target="_blank" rel="noreferrer" aria-label="WTSL TE4 mod">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><circle cx="12" cy="12" r="9" /><circle cx="9" cy="9" r="1.4" fill="var(--panel)" /><circle cx="15" cy="15" r="1.4" fill="var(--panel)" /><path d="M12 3a9 9 0 0 0 0 18" stroke="var(--panel)" strokeWidth="1.2" fill="none" /></svg>
            </a>
          </div>
        </div>
        <div className="footer-col">
          <h4>Forum</h4>
          <Link href="/discussions">Discussions</Link>
          <Link href="/discussions/new">Start a thread</Link>
          <Link href="/articles">Articles</Link>
          <Link href="/awards">Awards</Link>
        </div>
        <div className="footer-col">
          <h4>The Tour</h4>
          <Link href="/matches">Matches</Link>
          <Link href="/tournaments">Tournaments</Link>
          <Link href="/players">Players</Link>
          <Link href="/stats">Stats centre</Link>
          <Link href="/betting">Betting fixtures</Link>
          <Link href="/dashboard">Dashboard</Link>
        </div>
        <div className="footer-col">
          <h4>WTSL</h4>
          <a href="https://www.playwtsl.com/TE4" target="_blank" rel="noreferrer">WTSL site ↗</a>
          <Link href="/about">About</Link>
          <Link href="/rules">Community rules</Link>
        </div>
      </div>
      <div className="footer-base">
        <span>© {new Date().getFullYear()} WTSL Forum. WTSL and the WTSL logo belong to the World Tennis Simulation League.</span>
        <span>Community-run companion site</span>
      </div>
    </footer>
  );
}
