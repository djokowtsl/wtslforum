import Link from 'next/link';
import type { Metadata } from 'next';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import { DEFAULT_TOUR, isTourCode, type TourCode } from '@/lib/wtsl';
import { PublicFixturesProvider, PublicResultsProvider } from '@/components/PublicLiveData';
import { MatchesOpenFixtures, MatchesRecentResults } from '@/components/LiveMatchPanels';
import { initialPublicFixtures, initialPublicResults } from '@/lib/publicPageData';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;
export const metadata: Metadata = { title: 'Matches' };

// The WTSL betting bot only runs markets for singles (ATP/WTA) — Competitive Doubles, Coop
// and Created Characters never get fixtures. These are the only two tours it tags fixtures
// with, so BETTING_TOURS is just used to show the right "why is this empty" message.
const BETTING_TOURS: TourCode[] = ['TE4', 'TE4_(F)'];

export default async function Matches({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const { tour: tourParam } = await searchParams;
  const tour: TourCode = isTourCode(tourParam) && tourParam !== 'TE4_Coop' ? tourParam : DEFAULT_TOUR;
  const supportsBetting = BETTING_TOURS.includes(tour);
  const [initialResults, initialFixtures] = await Promise.all([
    initialPublicResults(30, tour),
    supportsBetting ? initialPublicFixtures() : Promise.resolve(undefined),
  ]);

  return (
    <PublicResultsProvider limit={30} tour={tour} initialFeed={initialResults}>
    <PublicFixturesProvider enabled={supportsBetting} initialFeed={initialFixtures}>
    <>
      <PageHero eyebrow="WTSL Tour" title="Matches">Results and upcoming fixtures. Want to talk about one? Take it to the <Link href="/discussions?c=match-talk" style={{ color: 'var(--lime)' }}>Match Talk</Link> board.</PageHero>
      <main className="container">
        <TourTabs basePath="/matches" current={tour} exclude={['TE4_Coop']} />
        <div className="section-head"><div><h2 className="display">Open fixtures</h2><p>Upcoming matches with current odds.</p></div><Link className="btn btn-primary btn-sm" href="/betting">🎲 Virtual Betting board</Link></div>
        <MatchesOpenFixtures tour={tour} />

        <div className="section-head section-space"><div><h2 className="display">Recent results</h2><p>The latest completed matches.</p></div></div>
        <MatchesRecentResults />
      </main>
    </>
    </PublicFixturesProvider>
    </PublicResultsProvider>
  );
}
