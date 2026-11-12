import type { Metadata } from 'next';
import Link from 'next/link';
import PageHero from '@/components/PageHero';
import MatchSchedulerBoard from '@/components/MatchSchedulerBoard';
import { getSession } from '@/lib/auth';
import { wtslCore, type CoreMatchSchedulerState } from '@/lib/wtsl-core';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Match scheduler' };

type Props = { searchParams: Promise<{ tournament?: string; match?: string }> };

export default async function MatchSchedulerPage({ searchParams }: Props) {
  const [session, query] = await Promise.all([getSession(), searchParams]);
  if (!session) {
    return (
      <>
        <PageHero eyebrow="Official WTSL draws" title="Match scheduler">Coordinate your draw match with a verified opponent. Your private Discord conversation stays part of the flow.</PageHero>
        <main className="scheduler-page">
          <section className="scheduler-empty"><strong>Sign in to view your matches</strong>Match schedules are private to their participants.<div><a className="btn btn-discord btn-sm" href="/api/auth/discord">Sign in with Discord</a></div></section>
        </main>
      </>
    );
  }

  let state: CoreMatchSchedulerState;
  try {
    state = await wtslCore.matchSchedulerState(session.discordId);
  } catch {
    return (
      <>
        <PageHero eyebrow="Official WTSL draws" title="Match scheduler">Coordinate a real match time, with your private Discord thread close at hand.</PageHero>
        <main className="scheduler-page"><section className="scheduler-empty"><strong>Scheduler data is temporarily unavailable</strong>We could not load your official WTSL matches just now. Please try again.<div><Link className="btn btn-sm" href="/match-scheduler">Retry</Link></div></section></main>
      </>
    );
  }

  return (
    <>
      <PageHero eyebrow="Official WTSL draws" title="Match scheduler">Turn availability into a confirmed match time. The browser and your private Discord thread work together.</PageHero>
      <MatchSchedulerBoard state={state} highlightedTournament={query.tournament} highlightedMatch={query.match} />
    </>
  );
}
