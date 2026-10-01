import type { Metadata } from 'next';
import Link from 'next/link';
import { safe } from '@/lib/db';
import { allPlayerStats, recentMatches, playersByNames } from '@/lib/stats';
import { wtslCore } from '@/lib/wtsl-core';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import PlayerStatsTable from '@/components/PlayerStatsTable';
import { DEFAULT_TOUR, isTourCode, tourLabel, type TourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Statistics' };

const MATCHLOG_TOUR: Partial<Record<TourCode, 'atp' | 'wta'>> = {
  TE4: 'atp',
  'TE4_(F)': 'wta',
};

const MATCH_RATINGS: { key: string; label: string }[] = [
  { key: 'Serve (Overall)', label: 'Serve' },
  { key: 'Return (Overall)', label: 'Return' },
  { key: 'Under Pressure', label: 'Under Pressure' },
];

async function matchLeaderboards(tour: TourCode) {
  const matchlogTour = MATCHLOG_TOUR[tour];
  if (!matchlogTour || !wtslCore.configured()) return null;
  const result = await safe(() => wtslCore.matchlogLeaderboard(matchlogTour), null);
  if (!result || result.rows.length === 0) return null;

  const names = Array.from(new Set(result.rows.map((r) => r.player)));
  const matchedPlayers = await safe(() => playersByNames(tour, names), [] as any[]);
  const byName = new Map(matchedPlayers.map((p: any) => [p.name.toLowerCase(), p]));

  const tables = MATCH_RATINGS.map(({ key, label }) => ({
    label,
    rows: result.rows
      .filter((r) => typeof r.ratings[key] === 'number')
      .sort((a, b) => b.ratings[key] - a.ratings[key])
      .slice(0, 10)
      .map((r) => ({ player: r.player, matches: r.matches, value: r.ratings[key], matched: byName.get(r.player.toLowerCase()) })),
  }));
  return tables;
}

type MatchRatingRow = { player: string; matches: number; value: number; matched?: any };

function MatchRatingTable({ tour, label, rows }: { tour: TourCode; label: string; rows: MatchRatingRow[] }) {
  return (
    <section className="panel">
      <div className="panel-head"><h2 className="display">{label}</h2></div>
      <table>
        <thead><tr><th>Player</th><th>Matches</th><th>Rating</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.player}>
            <td>{r.matched ? (
              <a className="player-line" href={`/players/${r.matched.wtsl_player_id}?tour=${encodeURIComponent(tour)}`}>{r.matched.avatar_url && <img src={r.matched.avatar_url} alt="" />}<span>{r.player}</span></a>
            ) : r.player}</td>
            <td>{r.matches}</td>
            <td>{Math.round(r.value)}</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

export default async function Stats({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const { tour: tourParam } = await searchParams;
  // Coop has no individual player stats on the official site, so it's not a valid selection here.
  const tour: TourCode = isTourCode(tourParam) && tourParam !== 'TE4_Coop' ? tourParam : DEFAULT_TOUR;
  const [rows, matches, matchTables] = await Promise.all([
    safe(() => allPlayerStats(tour), [] as any[]),
    safe(() => recentMatches(12, tour), [] as any[]),
    matchLeaderboards(tour),
  ]);
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
        {matchTables && (
          <>
            <div className="panel-head"><h2 className="display">Match log ratings</h2><span>{tourLabel(tour)} · serve, return &amp; pressure</span></div>
            <div className="dashboard-grid">
              {matchTables.map((t) => (
                <MatchRatingTable key={t.label} tour={tour} label={t.label} rows={t.rows} />
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}
