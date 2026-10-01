import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { leaderboard, recentMatches } from '@/lib/stats';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import { DEFAULT_TOUR, isTourCode, tourLabel, type TourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Statistics' };

export default async function Stats({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const { tour: tourParam } = await searchParams;
  const tour: TourCode = isTourCode(tourParam) ? tourParam : DEFAULT_TOUR;
  const [rows, matches] = await Promise.all([safe(() => leaderboard(tour), [] as any[]), safe(() => recentMatches(12, tour), [] as any[])]);
  return (
    <>
      <PageHero eyebrow="WTSL TE4" title="Statistics">Match statistics, player performance and the WTSL leaderboard.</PageHero>
      <main className="container">
        <TourTabs basePath="/stats" current={tour} />
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-head"><h2 className="display">Player leaderboard</h2><span>{tourLabel(tour)}</span></div>
            {rows.length === 0 ? <div className="empty"><strong>No stats yet</strong>The leaderboard fills in as matches are recorded.</div> : (
              <table>
                <thead><tr><th>Player</th><th>Matches</th><th>W</th><th>L</th><th>Win %</th><th>Tour Elo</th></tr></thead>
                <tbody>{rows.map((p: any) => (
                  <tr key={p.wtsl_player_id}>
                    <td><a className="player-line" href={`/players/${p.wtsl_player_id}?tour=${encodeURIComponent(tour)}`}>{p.avatar_url && <img src={p.avatar_url} alt="" />}<span>{p.name}<small>{p.country || ''}</small></span></a></td>
                    <td>{p.matches}</td><td>{p.wins}</td><td>{p.losses}</td><td>{p.win_pct}%</td><td>{p.tour_elo ?? '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </section>
          <aside className="panel">
            <div className="panel-head"><h2 className="display">Recent matches</h2></div>
            {matches.length === 0 ? <div className="empty">No matches recorded yet.</div> : matches.map((m: any) => (
              <div className="match-row" key={m.id}><div>{m.player_one_name}<br /><b>{m.score || '—'}</b><br />{m.player_two_name}</div><span>{m.round_name || m.tournament_key || ''}</span></div>
            ))}
          </aside>
        </div>
      </main>
    </>
  );
}
