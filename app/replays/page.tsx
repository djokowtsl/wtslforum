import type { Metadata } from 'next';
import Link from 'next/link';
import PageHero from '@/components/PageHero';
import DmoReplayLibrary from '@/components/DmoReplayLibrary';
import { listDmoReplaySubmissions } from '@/lib/dmoReplayLibrary';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Match Replays' };

export default async function ReplaysPage({
  searchParams,
}: {
  searchParams: Promise<{ match?: string }>;
}) {
  const user = await getSession();
  if (!user) {
    return (
      <PageHero
        className="replays-page-hero"
        eyebrow="Official WTSL match replays"
        title="Match Replays"
        actions={<a className="btn btn-discord btn-sm" href="/api/auth/discord">Log in with Discord</a>}
      >
        Sign in to browse and watch official match replays.
      </PageHero>
    );
  }
  const params = await searchParams;
  const initialMatchId = params.match && /^\d{1,19}$/.test(params.match) ? params.match : '';
  let initialPage: Awaited<ReturnType<typeof listDmoReplaySubmissions>> | null = null;
  try {
    initialPage = await listDmoReplaySubmissions({ limit: 24 });
  } catch {
    // Let the client retry through the API so database outages show the existing error state.
  }
  return (
    <>
      <PageHero
        className="replays-page-hero"
        eyebrow="Official WTSL match replays"
        title="Match Replays"
        actions={<Link className="btn btn-sm" href="/livestreams">Live streams</Link>}
      >
        Browse current DMO submissions from the Forum and Discord. Signed-in members can watch stored match files or open submitted recording links.
      </PageHero>
      <main className="container">
        <DmoReplayLibrary initialMatchId={initialMatchId} initialPage={initialPage} />
      </main>
    </>
  );
}
