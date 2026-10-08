import Link from 'next/link';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { safe } from '@/lib/db';
import { readLiveData } from '@/lib/liveData';
import { recentWtslSiteMatches } from '@/lib/stats';
import { openFixtures } from '@/lib/betting';
import { getTournaments } from '@/lib/tournaments';
import { FixtureCard, ResultCard } from '@/components/MatchCards';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import WtslDataAutoRefresh from '@/components/WtslDataAutoRefresh';
import { DEFAULT_TOUR, isTourCode, type TourCode } from '@/lib/wtsl';
import { selectPublicOpenFixtures } from '@/lib/fixture-order';
import { buildWtslTournamentNameLookup } from '@/lib/wtslResultDisplay';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;
export const metadata: Metadata = { title: 'Matches' };

// The WTSL betting bot only runs markets for singles (ATP/WTA) — Competitive Doubles, Coop
// and Created Characters never get fixtures. These are the only two tours it tags fixtures
// with, so BETTING_TOURS is just used to show the right "why is this empty" message.
const BETTING_TOURS: TourCode[] = ['TE4', 'TE4_(F)'];

function MatchesDataLoading({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="forum-list">
      <div className="empty" role="status" aria-live="polite">
        <strong>{label}</strong>{detail}
      </div>
    </div>
  );
}

async function OpenFixturesSection({ tour }: { tour: TourCode }) {
  const supportsBetting = BETTING_TOURS.includes(tour);
  const [fixturesState, tournaments] = await Promise.all([
    supportsBetting
      ? readLiveData(() => openFixtures(), [] as any[])
      : Promise.resolve({ data: [] as any[], unavailable: false }),
    safe(() => getTournaments(tour), [] as any[]),
  ]);
  const fx = selectPublicOpenFixtures(
    Array.isArray(fixturesState.data)
      ? fixturesState.data.filter((f: any) => String(f.tour) === tour)
      : [],
    tournaments,
  );

  if (supportsBetting && fixturesState.unavailable) {
    return <div className="notice warn" role="status">The live fixture feed is unavailable right now. This does not mean there are no open matches. Please try again shortly.</div>;
  }

  return fx.length === 0 ? (
    <div className="forum-list"><div className="empty"><strong>No open fixtures right now</strong>{supportsBetting ? 'New fixtures appear here as soon as the next round is set.' : 'The betting bot only runs markets for ATP and WTA singles — this tour has no fixtures.'}</div></div>
  ) : (
    <div className="live-grid">{fx.map((f: any) => <FixtureCard key={f.key} f={f} />)}</div>
  );
}

async function RecentResultsSection({ tour }: { tour: TourCode }) {
  const [results, tournaments] = await Promise.all([
    safe(() => recentWtslSiteMatches(30, tour), [] as any[]),
    safe(() => getTournaments(tour), [] as any[]),
  ]);
  const names = buildWtslTournamentNameLookup(tournaments);

  return results.length === 0 ? (
    <div className="forum-list"><div className="empty"><strong>No results yet</strong>Completed matches will be listed here.</div></div>
  ) : (
    <div className="live-grid">{results.map((m: any) => <ResultCard key={m.id} m={m} tournamentNames={names} />)}</div>
  );
}

export default async function Matches({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const { tour: tourParam } = await searchParams;
  const tour: TourCode = isTourCode(tourParam) && tourParam !== 'TE4_Coop' ? tourParam : DEFAULT_TOUR;
  const supportsBetting = BETTING_TOURS.includes(tour);

  return (
    <>
      <WtslDataAutoRefresh />
      <PageHero eyebrow="WTSL Tour" title="Matches">Results and upcoming fixtures. Want to talk about one? Take it to the <Link href="/discussions?c=match-talk" style={{ color: 'var(--lime)' }}>Match Talk</Link> board.</PageHero>
      <main className="container">
        <TourTabs basePath="/matches" current={tour} exclude={['TE4_Coop']} />
        <div className="section-head"><div><h2 className="display">Open fixtures</h2><p>Upcoming matches with current odds.</p></div><Link className="btn btn-primary btn-sm" href="/betting">🎲 Virtual Betting board</Link></div>
        <Suspense fallback={<MatchesDataLoading label="Checking live fixtures" detail="Verifying upcoming pairings against the current official draws." />}>
          <OpenFixturesSection tour={tour} />
        </Suspense>

        <div className="section-head section-space"><div><h2 className="display">Recent results</h2><p>The latest completed matches.</p></div></div>
        <Suspense fallback={<MatchesDataLoading label="Loading recent results" detail="Completed match results will appear here." />}>
          <RecentResultsSection tour={tour} />
        </Suspense>
      </main>
    </>
  );
}
