import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { leaderboard, recentMatches } from '@/lib/stats';
import { openFixtures } from '@/lib/betting';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dashboard' };

export default async function Dashboard() {
  const [players, matches, fx] = await Promise.all([safe(() => leaderboard(), [] as any[]), safe(() => recentMatches(8), [] as any[]), safe(() => openFixtures(), [] as any[])]);
  const fixtures = Array.isArray(fx) ? fx : [];
  return (
    <>
      <PageHero eyebrow="WTSL Community" title="Dashboard">A snapshot of the tour: performance leaders, recent matches and open fixtures.</PageHero>
      <main className="container">
        <div className="kpi-grid">
          <div><span>Open fixtures</span><b>{fixtures.length}</b></div><div><span>Tracked players</span><b>{players.length}</b></div><div><span>Recent matches</span><b>{matches.length}</b></div><div><span>Data source</span><b>WTSL TE4</b></div>
        </div>
        <div className="dashboard-grid">
          <section className="panel"><div className="panel-head"><h2 className="display">Performance leaders</h2></div>
            {players.length === 0 ? <div className="empty">No player data yet.</div> : players.slice(0, 8).map((p: any, i: number) => (
              <div className="leader-row" key={p.wtsl_player_id}><b>#{i + 1}</b><div className="player-line">{p.avatar_url && <img src={p.avatar_url} alt="" />}<span>{p.name}<small>Tour Elo {p.tour_elo ?? '—'} · {p.wins} wins</small></span></div><strong>{p.win_pct}%</strong></div>
            ))}
          </section>
          <section className="panel"><div className="panel-head"><h2 className="display">Open fixtures</h2></div>
            {fixtures.length === 0 ? <div className="empty">No open fixtures.</div> : fixtures.slice(0, 8).map((f: any) => (
              <div className="match-row" key={f.key}><div><b>{f.first_name}</b> vs <b>{f.second_name}</b><small>{f.tournament || 'WTSL'}</small></div><span>{Number(f.odds_one).toFixed(2)} / {Number(f.odds_two).toFixed(2)}</span></div>
            ))}
          </section>
        </div>
      </main>
    </>
  );
}
