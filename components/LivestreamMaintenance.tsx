import Link from 'next/link';
import PageHero from './PageHero';

export default function LivestreamMaintenance() {
  return (
    <>
      <PageHero eyebrow="Live streams and match replays" title="Temporarily unavailable">
        Live streams and match replays are temporarily inaccessible while we improve the viewing experience.
        Please check back later.
      </PageHero>
      <main className="container">
        <Link className="btn btn-sm" href="/">Back to the Forum</Link>
      </main>
    </>
  );
}
