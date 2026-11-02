import type { Metadata } from 'next';
import Link from 'next/link';
import PageHero from '@/components/PageHero';
import DmoReplayLibrary from '@/components/DmoReplayLibrary';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Match Replays' };

export default async function ReplaysPage({
  searchParams,
}: {
  searchParams: Promise<{ match?: string }>;
}) {
  const params = await searchParams;
  const initialMatchId = params.match && /^\d{1,19}$/.test(params.match) ? params.match : '';
  return (
    <>
      <PageHero
        eyebrow="Official matches, shared by the community"
        title="Match Replays"
        actions={<Link className="btn btn-sm" href="/livestreams">Live streams</Link>}
      >
        Rewatch official WTSL matches recorded and submitted by the players.
      </PageHero>
      <main className="container">
        <DmoReplayLibrary initialMatchId={initialMatchId} />
      </main>
    </>
  );
}
