import Link from 'next/link';
import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { recentMatches } from '@/lib/stats';
import { openFixtures } from '@/lib/betting';
import { getTournaments } from '@/lib/tournaments';
import { FixtureCard, ResultCard } from '@/components/MatchCards';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import { DEFAULT_TOUR, isTourCode, type TourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Matches' };

// The WTSL betting bot only runs markets for singles (ATP/WTA) — Competitive Doubles, Coop
// and Created Characters never get fixtures. These are the only two tours it tags fixtures
// with, so BETTING_TOURS is just used to show the right "why is this empty" message.
const BETTING_TOURS: TourCode[] = ['TE4', 'TE4_(F)'];

export default async function Matches({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const { tour: tourParam } = await searchParams;
  const tour: TourCode = isTourCode(tourParam) && tourParam !== 'TE4_Coop' ? tourParam : DEFAULT_TOUR;
  const [results, fixtures, tournaments] = await Promise.all([
    safe(() => recentMatches(30, tour), [] as any[]),
    safe(() => openFixtures(), [] as any[]),
    safe(() => getTournaments(tour), [] as any[]),
  ]);
  const names = Object.fromEntries(tournaments.map((t: any) => [t.wtsl_tournament_key, t.name]));
  const supportsBetting = BETTING_TOURS.includes(tour);
  // Fixtures come back tagged with the same raw tour codes used everywhere else on the
  // forum ("TE4", "TE4_(F)") — not "atp"/"wta" — so compare directly against the selected tour.
  const fx = Array.isArray(fixtures)
    ? fixtures.filter((f: any) => String(f.tour) === tour)
    : [];

  return (
    <>
      <PageHero eyebrow="WTSL Tour" title="Matches">Results and upcoming fixtures. Want to talk about one? Take it to the <Link href="/discussions?c=match-talk" style={{ color: 'var(--lime)' }}>Match Talk</Link> board.</PageHero>
      <main className="container">
        <TourTabs basePath="/matches" current={tour} exclude={['TE4_Coop']} />
        <div className="section-head"><div><h2 className="display">Open fixtures</h2><p>Upcoming matches with current odds.</p></div><Link className="btn btn-primary btn-sm" href="/betting">🎲 Betting board</Link></div>
        {fx.length === 0 ? <div className="forum-list"><div className="empty"><strong>No open fixtures right now</strong>{supportsBetting ? 'New fixtures appear here as soon as the next round is set.' : 'The betting bot only runs markets for ATP and WTA singles — this tour has no fixtures.'}</div></div> : <div className="live-grid">{fx.map((f: any) => <FixtureCard key={f.key} f={f} />)}</div>}

        <div className="section-head section-space"><div><h2 className="display">Recent results</h2><p>The latest completed matches.</p></div></div>
        {results.length === 0 ? <div className="forum-list"><div className="empty"><strong>No results yet</strong>Completed matches will be listed here.</div></div> : <div className="live-grid">{results.map((m: any) => <ResultCard key={m.id} m={m} tournamentNames={names} />)}</div>}
      </main>
    </>
  );
}
