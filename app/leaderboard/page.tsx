import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { leaderboard, LEADERBOARD_MIN_MATCHES } from '@/lib/stats';
import PageHero from '@/components/PageHero';
import MetricSampleEvidence from '@/components/MetricSampleEvidence';
import RatingEvidence from '@/components/RatingEvidence';
import RatingMethodNote from '@/components/RatingMethodNote';
import LeaderboardMetricPicker from '@/components/LeaderboardMetricPicker';
import TourTabs from '@/components/TourTabs';
import { DEFAULT_TOUR, isTourCode, type TourCode } from '@/lib/wtsl';
import {
  BOT_METRICS,
  BOT_RATING_METRICS,
  botLeaderboard,
  botRatingLeaderboard,
  isBotMetric,
  type BotMetric,
  type BotRating,
} from '@/lib/botRatingLeaderboards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Leaderboard' };

type ResultMetric = 'wins' | 'win_pct' | 'elo' | 'aces' | 'winners' | 'break_points' | 'first_serve_pct';
type ForumMetric = ResultMetric | BotMetric;
const RESULT_METRICS: { key: ResultMetric; label: string }[] = [
  { key: 'wins', label: 'Wins' },
  { key: 'win_pct', label: 'Win %' },
  { key: 'elo', label: 'Tour Elo' },
  { key: 'aces', label: 'Aces' },
  { key: 'winners', label: 'Winners' },
  { key: 'break_points', label: 'Break points won' },
  { key: 'first_serve_pct', label: '1st serve %' },
];

const FORUM_METRICS: { key: ForumMetric; label: string }[] = [
  ...RESULT_METRICS,
  ...BOT_METRICS.map((metric) => ({ key: metric.key, label: metric.label })),
];

function percentagePoints(value: number): number {
  return value >= 0 && value <= 1 ? value * 100 : value;
}

function formatPercentage(value: unknown): string {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const formatted = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })
    .format(percentagePoints(number));
  return `${formatted}%`;
}

function formatBotMetric(value: number, format: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (format === 'rating') return number.toFixed(1);
  if (format === 'percent') return formatPercentage(number);
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(number);
}

function formatResultMetric(metric: ResultMetric, player: any): string | number {
  if (metric === 'wins') return player.wins;
  if (metric === 'win_pct') return formatPercentage(player.win_pct);
  if (metric === 'aces') return player.aces;
  if (metric === 'winners') return player.winners;
  if (metric === 'break_points') return player.break_points_won;
  if (metric === 'first_serve_pct') return formatPercentage(player.first_serve_pct);
  return player.tour_elo ?? '—';
}

export default async function Leaderboard({ searchParams }: { searchParams: Promise<{ tour?: string; metric?: string }> }) {
  const { tour: tourParam, metric: metricParam } = await searchParams;
  const tour: TourCode = isTourCode(tourParam) ? tourParam : DEFAULT_TOUR;
  const metric: ForumMetric = isBotMetric(metricParam ?? '')
    ? metricParam as BotMetric
    : RESULT_METRICS.some((item) => item.key === metricParam)
      ? metricParam as ResultMetric
      : 'wins';
  const screenshotMetric = isBotMetric(metric);
  const botMetric = screenshotMetric ? BOT_METRICS.find((item) => item.key === metric) : null;
  const valueLabel = botMetric?.label ?? RESULT_METRICS.find((item) => item.key === metric)?.label ?? 'Wins';
  const isRating = BOT_RATING_METRICS.some((item) => item.key === metric);

  const rows = await safe(
    () => isRating
      ? botRatingLeaderboard(tour, metric as BotRating)
      : screenshotMetric
        ? botLeaderboard(tour, metric as BotMetric)
        : leaderboard(tour, metric),
    [] as any[],
  );
  const eligibilityLabel = screenshotMetric
    ? `${LEADERBOARD_MIN_MATCHES}+ screenshot matches`
    : `${LEADERBOARD_MIN_MATCHES}+ recorded matches`;

  return (
    <>
      <PageHero eyebrow="WTSL TE4" title="Leaderboard">
        Compare players across the tour by the selected metric.
      </PageHero>
      <main className="container">
        <TourTabs basePath="/leaderboard" current={tour} extraParams={{ metric }} />
        {isRating && <RatingMethodNote />}
        <div className="section-head">
          <div>
            <h2 className="display">Player Statistics</h2>
            <span>{eligibilityLabel}</span>
          </div>
          <LeaderboardMetricPicker current={metric} tour={tour} metrics={FORUM_METRICS} />
        </div>
        <section className="panel">
          {rows.length === 0 ? <div className="empty"><strong>No stats yet</strong>The leaderboard fills in as more match data is recorded.</div> : (
            <div className="table-scroll">
              <table>
                <thead><tr><th>#</th><th>Player</th><th>{screenshotMetric ? 'Screenshot matches' : 'Matches'}</th><th>{valueLabel}</th></tr></thead>
                <tbody>{rows.map((player: any, index: number) => {
                  const name = screenshotMetric && !isRating ? player.player : player.name;
                  const playerId = screenshotMetric && !isRating ? player.wtslPlayerId : player.wtsl_player_id;
                  const avatar = screenshotMetric && !isRating ? player.avatarUrl : player.avatar_url;
                  const country = player.country;
                  const value = screenshotMetric
                    ? formatBotMetric(player.value, botMetric?.valueFormat ?? 'number')
                    : formatResultMetric(metric as ResultMetric, player);
                  return (
                    <tr key={playerId ?? `${name}-${index}`}>
                      <td>{index + 1}</td>
                      <td>
                        {playerId ? (
                          <a className="player-line" href={`/players/${encodeURIComponent(playerId)}?tour=${encodeURIComponent(tour)}`}>
                            {avatar && <img src={avatar} alt="" />}
                            <span>{name}<small>{country || ''}</small></span>
                          </a>
                        ) : <span className="player-line"><span>{name}<small>Unlinked player</small></span></span>}
                      </td>
                      <td>{player.matches}</td>
                      <td>
                        {value}
                        {metric === 'wins' || metric === 'win_pct' || metric === 'elo'
                          ? null
                          : screenshotMetric
                            ? isRating
                              ? <RatingEvidence metric={metric as BotRating} counts={player.ratingComponentCounts} />
                              : <MetricSampleEvidence metricLabel={valueLabel} sampleCount={player.metricSampleCount} />
                            : <MetricSampleEvidence metricLabel={valueLabel} sampleCount={player.matches} />}
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
