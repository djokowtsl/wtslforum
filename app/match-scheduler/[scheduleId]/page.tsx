import type { Metadata } from 'next';
import Link from 'next/link';
import PageHero from '@/components/PageHero';
import MatchSchedulerDetail from '@/components/MatchSchedulerDetail';
import { getSession } from '@/lib/auth';
import { wtslCore } from '@/lib/wtsl-core';
import { getAdminMatchSchedule } from '@/lib/matchSchedulerAdmin';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Match schedule' };

type Props = { params: Promise<{ scheduleId: string }> };

export default async function MatchSchedulerDetailPage({ params }: Props) {
  const [{ scheduleId }, session] = await Promise.all([params, getSession()]);
  if (!session) {
    return (
      <>
        <PageHero eyebrow="Official WTSL draws" title="Match schedule">Sign in with the Discord account linked to your verified player profile.</PageHero>
        <main className="scheduler-page"><section className="scheduler-empty"><strong>Sign in to view this schedule</strong>Match details are private to the two participants.<div><a className="btn btn-discord btn-sm" href="/api/auth/discord">Sign in with Discord</a></div></section></main>
      </>
    );
  }

  try {
    const { schedule } = await wtslCore.matchSchedulerDetail(session.discordId, scheduleId);
    return (
      <>
        <PageHero eyebrow="Official WTSL draws" title="Match schedule">Agree on a time in the same private conversation you already use in Discord.</PageHero>
        <MatchSchedulerDetail initialSchedule={schedule} viewerDiscordId={session.discordId} />
      </>
    );
  } catch {
    if (session.isAdmin) {
      try {
        const schedule = await getAdminMatchSchedule(scheduleId);
        if (schedule) {
          return (
            <>
              <PageHero eyebrow="Staff · read-only" title="Match schedule">Review this schedule without changing player decisions.</PageHero>
              <MatchSchedulerDetail
                initialSchedule={schedule}
                viewerDiscordId={session.discordId}
                readOnly
              />
            </>
          );
        }
      } catch {
        // Keep the same unavailable state if the authenticated Core API is down.
      }
    }
    return (
      <>
        <PageHero eyebrow="Official WTSL draws" title="Match schedule">Schedule details are only available to its participants.</PageHero>
        <main className="scheduler-page"><section className="scheduler-empty"><strong>Schedule unavailable</strong>This schedule may have closed, or you may not have access to it. Return to your match list to check the latest status.<div><Link className="btn btn-sm" href={session.isAdmin ? '/admin/match-scheduler' : '/match-scheduler'}>{session.isAdmin ? 'Admin schedule list' : 'Your match schedules'}</Link></div></section></main>
      </>
    );
  }
}
