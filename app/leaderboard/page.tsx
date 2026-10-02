import type { Metadata } from 'next';
import Link from 'next/link';
import { safe } from '@/lib/db';
import { leaderboard, LEADERBOARD_MIN_MATCHES } from '@/lib/stats';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import { DEFAULT_TOUR, isTourCode, type TourCode } from '@/lib/wtsl';
import RatingEvidence from '@/components/RatingEvidence';
import {
  BOT_RATING_METRICS,
  botRatingLeaderboard,
  type BotRating,
} from '@/lib/botRatingLeaderboards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Leaderboard' };

type ForumMetric = 'wins' | 'win_pct' | 'elo' | 'aces' | 'winners' | 'break_points' | 'first_serve_pct' | BotRating;
const FORUM_METRICS: { key: ForumMetric; label: string }[] = [
  { key: 'wins', label: 'Wins' },
  { key: 'win_pct', label: 'Win %' },
  { key: 'elo', label: 'Tour Elo' },
  { key: 'aces', label: 'Aces' },
  { key: 'winners', label: 'Winners' },
  { key: 'break_points', label: 'Break points won' },
  { key: 'first_serve_pct', label: '1st serve %' },
  ...BOT_RATING_METRICS.map((metric) => ({ key: metric.key, label: metric.key === 'pressure' ? 'Under pressure' : metric.label })),
];

const VALUE_COLUMN: Record<ForumMetric, { label: string; render: (p: any) => string | number }> = {
  wins: { label: 'Wins', render: (p) => p.wins },
  win_pct: { label: 'Win %', render: (p) => `${p.win_pct}%` },
  elo: { label: 'Tour Elo', render: (p) => p.tour_elo ?? '—' },
  aces: { label: 'Aces', render: (p) => p.aces },
  winners: { label: 'Winners', render: (p) => p.winners },
  break_points: { label: 'Break points won', render: (p) => p.break_points_won },
  first_serve_pct: { label: '1st serve %', render: (p) => `${p.first_serve_pct}%` },
  serve: { label: 'Serve', render: (p) => Number(p.value).toFixed(1) },
  return: { label: 'Return', render: (p) => Number(p.value).toFixed(1) },
  pressure: { label: 'Under pressure', render: (p) => Number(p.value).toFixed(1) },
};

export default async function Leaderboard({ searchParams }: { searchParams: Promise<{ tour?: string; metric?: string }> }) {
  const { tour: tourParam, metric: metricParam } = await searchParams;
  const tour: TourCode = isTourCode(tourParam) ? tourParam : DEFAULT_TOUR;
  const metric: ForumMetric = FORUM_METRICS.some((item) => item.key === metricParam)
    ? metricParam as ForumMetric
    : 'wins';
  const valueLabel = VALUE_COLUMN[metric].label;
  const isRating = BOT_RATING_METRICS.some((item) => item.key === metric);

  const rows = await safe(
    () => isRating
      ? botRatingLeaderboard(tour, metric as BotRating)
      : leaderboard(tour, metric),
    [] as any[],
  );
  const eligibilityLabel = `${LEADERBOARD_MIN_MATCHES}+ matches with available data`;

  return (
    <>
      <PageHero eyebrow="WTSL TE4" title="Leaderboard">
        Compare players across the tour by the selected metric.
      </PageHero>
      <main className="container">
        <TourTabs basePath="/leaderboard" current={tour} extraParams={{ metric }} />
        <div className="section-head">
          <div>
            <span>{eligibilityLabel}</span>
          </div>
          <div className="tabs-scroll">
            {FORUM_METRICS.map((item) => (
              <Link key={item.key} className={`tour-tab${item.key === metric ? ' active' : ''}`} href={`/leaderboard?tour=${encodeURIComponent(tour)}&metric=${encodeURIComponent(item.key)}`}>{item.label}</Link>
            ))}
          </div>
        </div>
        <div className="section-head">
          <div>
            <h2 className="display">Ranked by {valueLabel.toLowerCase()}</h2>
            <span>Highest first</span>
          </div>
        </div>
        <section className="panel">
          {rows.length === 0 ? <div className="empty"><strong>No stats yet</strong>The leaderboard fills in as more match data is recorded.</div> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>#</th><th>Player</th><th>{isRating ? 'Screenshots' : 'Matches'}</th><th>{valueLabel}</th></tr></thead>
                <tbody>{rows.map((player: any, index: number) => {
                  return (
                    <tr key={player.wtsl_player_id}>
                      <td>{index + 1}</td>
                      <td><a className="player-line" href={`/players/${encodeURIComponent(player.wtsl_player_id)}?tour=${encodeURIComponent(tour)}`}>{player.avatar_url && <img src={player.avatar_url} alt="" />}<span>{player.name}<small>{player.country || ''}</small></span></a></td>
                      <td>{player.matches}</td>
                      <td>
                        {VALUE_COLUMN[metric].render(player)}
                        {isRating && <RatingEvidence metric={metric as BotRating} counts={player.ratingComponentCounts} />}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}