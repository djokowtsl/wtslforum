import Link from 'next/link';

export function ForumFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <img src="/brand/wtsl-logo-200.png" alt="WTSL — World Tennis Simulation League" width={215} height={200} />
          <p>The community home of the World Tennis Simulation League — where the people behind the tour talk matches, tournaments and stories.</p>
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
        </div>
        <div className="footer-col">
          <h4>WTSL</h4>
          <a href="https://www.playwtsl.com/TE4" target="_blank" rel="noreferrer">Official WTSL site ↗</a>
          <Link href="/about">About</Link>
          <Link href="/rules">Community rules</Link>
        </div>
      </div>
      <div className="footer-base">
        <span>© {new Date().getFullYear()} WTSL Community. WTSL and the WTSL logo belong to the World Tennis Simulation League.</span>
        <span>Community-run companion site · Sign-in by Discord</span>
      </div>
    </footer>
  );
}
