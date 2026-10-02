import type { Metadata } from 'next';
import Link from 'next/link';
import { safe } from '@/lib/db';
import { leaderboard, LEADERBOARD_MIN_MATCHES } from '@/lib/stats';
import { botRatingLeaderboard, type BotRating } from '@/lib/botRatingLeaderboards';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import { DEFAULT_TOUR, isTourCode, type TourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Leaderboard' };

type MetricKey = 'wins' | 'win_pct' | 'elo' | 'aces' | 'winners' | 'break_points' | 'first_serve_pct' | BotRating;

const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'wins', label: 'Wins' },
  { key: 'win_pct', label: 'Win %' },
  { key: 'elo', label: 'Tour Elo' },
  { key: 'aces', label: 'Aces' },
  { key: 'winners', label: 'Winners' },
  { key: 'break_points', label: 'Break points won' },
  { key: 'first_serve_pct', label: '1st serve %' },
  { key: 'serve', label: 'Serve' },
  { key: 'return', label: 'Return' },
  { key: 'pressure', label: 'Under Pressure' },
];

const VALUE_COLUMN: Record<MetricKey, { label: string; render: (p: any) => string | number }> = {
  wins: { label: 'Wins', render: (p) => p.wins },
  win_pct: { label: 'Win %', render: (p) => `${p.win_pct}%` },
  elo: { label: 'Tour Elo', render: (p) => p.tour_elo ?? '—' },
  aces: { label: 'Aces', render: (p) => p.aces },
  winners: { label: 'Winners', render: (p) => p.winners },
  break_points: { label: 'Break points won', render: (p) => p.break_points_won },
  first_serve_pct: { label: '1st serve %', render: (p) => `${p.first_serve_pct}%` },
  serve: { label: 'Serve', render: (p) => Math.round(p.value) },
  return: { label: 'Return', render: (p) => Math.round(p.value) },
  pressure: { label: 'Under Pressure', render: (p) => Math.round(p.value) },
};

function isBotRatingMetric(metric: MetricKey): metric is BotRating {
  return metric === 'serve' || metric === 'return' || metric === 'pressure';
}

export default async function Leaderboard({ searchParams }: { searchParams: Promise<{ tour?: string; metric?: string }> }) {
  const { tour: tourParam, metric: metricParam } = await searchParams;
  const tour: TourCode = isTourCode(tourParam) ? tourParam : DEFAULT_TOUR;
  const metric: MetricKey = METRICS.some((m) => m.key === metricParam) ? metricParam as MetricKey : 'wins';
  const rows = await safe(async () => {
    if (isBotRatingMetric(metric)) {
      const ratingRows = await botRatingLeaderboard(tour, metric);
      return ratingRows
        .filter((row) => row.matches >= LEADERBOARD_MIN_MATCHES)
        .map((row) => ({
          wtsl_player_id: row.playerId,
          name: row.player,
          avatar_url: null,
          country: '',
          matches: row.matches,
          value: row.value,
        }));
    }
    return leaderboard(tour, metric);
  }, [] as any[]);
  const valueCol = VALUE_COLUMN[metric];

  return (
    <>
      <PageHero eyebrow="WTSL TE4" title="Leaderboard">Players ranked by stat, highest first — only players with {LEADERBOARD_MIN_MATCHES}+ {isBotRatingMetric(metric) ? 'screenshots' : 'recorded matches'} are ranked, to keep small sample sizes from skewing the top spots. Looking for the full A–Z breakdown instead? Head to <Link href="/stats" style={{ color: 'var(--lime)' }}>Statistics</Link>.</PageHero>
      <main className="container">
        <TourTabs basePath="/leaderboard" current={tour} extraParams={{ metric }} />
        <div className="section-head">
          <div><h2 className="display">Ranked by {valueCol.label.toLowerCase()}</h2><span>{LEADERBOARD_MIN_MATCHES}+ {isBotRatingMetric(metric) ? 'screenshots' : 'matches played'}</span></div>
          <div className="tabs-scroll">
            {METRICS.map((m) => (
              <Link key={m.key} className={`tour-tab${m.key === metric ? ' active' : ''}`} href={`/leaderboard?tour=${encodeURIComponent(tour)}&metric=${encodeURIComponent(m.key)}`}>{m.label}</Link>
            ))}
          </div>
        </div>
        <section className="panel">
          {rows.length === 0 ? <div className="empty"><strong>{isBotRatingMetric(metric) ? 'No ratings yet' : 'No stats yet'}</strong>{isBotRatingMetric(metric) ? 'Screenshot ratings appear after the bot syncs the leaderboard.' : 'The leaderboard fills in as matches are recorded.'}</div> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>#</th><th>Player</th><th>{isBotRatingMetric(metric) ? 'Screenshots' : 'Matches'}</th><th>{valueCol.label}</th></tr></thead>
                <tbody>{rows.map((p: any, i: number) => (
                  <tr key={p.wtsl_player_id}>
                    <td>{i + 1}</td>
                    <td><a className="player-line" href={`/players/${p.wtsl_player_id}?tour=${encodeURIComponent(tour)}`}>{p.avatar_url && <img src={p.avatar_url} alt="" />}<span>{p.name}<small>{p.country || ''}</small></span></a></td>
                    <td>{p.matches}</td>
                    <td>{valueCol.render(p)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
