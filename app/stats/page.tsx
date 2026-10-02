import type { Metadata } from 'next';
import Link from 'next/link';
import { safe } from '@/lib/db';
import { allPlayerStats, LEADERBOARD_MIN_MATCHES, recentMatches } from '@/lib/stats';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import PlayerStatsTable from '@/components/PlayerStatsTable';
import { DEFAULT_TOUR, isTourCode, type TourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Statistics' };

export default async function Stats({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const { tour: tourParam } = await searchParams;
  // Coop has no individual player stats on the official site, so it's not a valid selection here.
  const tour: TourCode = isTourCode(tourParam) && tourParam !== 'TE4_Coop' ? tourParam : DEFAULT_TOUR;
  const [allRows, matches] = await Promise.all([
    safe(() => allPlayerStats(tour), [] as any[]),
    safe(() => recentMatches(12, tour), [] as any[]),
  ]);
  const rows = allRows.filter((row: any) => row.matches >= LEADERBOARD_MIN_MATCHES);
  return (
    <>
      <PageHero eyebrow="WTSL TE4" title="Statistics">Match statistics and player performance, A–Z. Want players ranked by a stat instead? Check the <Link href="/leaderboard" style={{ color: 'var(--lime)' }}>Leaderboard</Link>.</PageHero>
      <main className="container">
        <div className="notice warn" style={{ marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 600 }}>
          <span>🚧</span>
          <span>These statistics are still under construction and may not reflect every match in the WTSL database yet. For the most complete and accurate numbers, use <code>/wtslstats</code> in Discord.</span>
        </div>
        <TourTabs basePath="/stats" current={tour} exclude={['TE4_Coop']} />
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-head"><h2 className="display">Player Statistics</h2></div>
            {rows.length === 0 ? <div className="empty"><strong>No stats yet</strong>Statistics fill in as matches are recorded.</div> : (
              <PlayerStatsTable rows={rows as any} tour={tour} />
            )}
          </section>
          <aside className="panel">
            <div className="panel-head"><h2 className="display">Recent matches</h2></div>
            {matches.length === 0 ? <div className="empty">No matches recorded yet.</div> : matches.map((m: any) => (
              <div className="match-row" key={m.id}><div>{m.player_one_name}<br /><b>{m.score || '—'}</b><br />{m.player_two_name}</div><span>{m.tournament_name || m.tournament_key || ''}{m.round_name ? ` · ${m.round_name}` : ''}</span></div>
            ))}
          </aside>
        </div>
        <p className="empty" style={{ marginTop: 20 }}>Only players with at least {LEADERBOARD_MIN_MATCHES} recorded matches are shown. Select any table header to sort it.</p>
      </main>
    </>
  );
}
