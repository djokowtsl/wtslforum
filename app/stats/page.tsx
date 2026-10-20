import type { Metadata } from 'next';
import Link from 'next/link';
import { safe } from '@/lib/db';
import { allPlayerStats, leaderboard, LEADERBOARD_MIN_MATCHES, recentMatches } from '@/lib/stats';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import PlayerStatsTable from '@/components/PlayerStatsTable';
import { DEFAULT_TOUR, isTourCode, type TourCode } from '@/lib/wtsl';
import { botLeaderboardStats, type BotLeaderboardStatsRow } from '@/lib/botRatingLeaderboards';
import { getTournaments } from '@/lib/tournaments';
import { buildWtslTournamentNameLookup, lookupWtslTournamentName } from '@/lib/wtslResultDisplay';
import { FORUM_LEADERBOARD_METRICS } from '@/lib/forumLeaderboardMetrics';
import {
  calculateTourMetricAverages,
  formatLeaderboardMetric,
} from '@/lib/leaderboardTourAverage.mjs';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Statistics' };

export default async function Stats({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const { tour: tourParam } = await searchParams;
  // Coop has no individual player stats on the official site, so it's not a valid selection here.
  const tour: TourCode = isTourCode(tourParam) && tourParam !== 'TE4_Coop' ? tourParam : DEFAULT_TOUR;
  const [allRows, matches, screenshotRows, tournaments, officialLeaderboardRows] = await Promise.all([
    safe(() => allPlayerStats(tour), [] as any[]),
    safe(() => recentMatches(8, tour), [] as any[]),
    safe(() => botLeaderboardStats(tour), [] as BotLeaderboardStatsRow[]),
    safe(() => getTournaments(tour), [] as any[]),
    safe(() => leaderboard(tour, 'wins'), [] as any[]),
  ]);
  const tournamentNames = buildWtslTournamentNameLookup(tournaments);
  const screenshotByPlayer = new Map<string, BotLeaderboardStatsRow>(
    screenshotRows
      .filter((row) => row.wtslPlayerId !== null)
      .map((row) => [String(row.wtslPlayerId), row]),
  );
  const rows = allRows
    .filter((row: any) => row.matches >= LEADERBOARD_MIN_MATCHES)
    .map((row: any) => {
      const screenshotStats = screenshotByPlayer.get(String(row.wtsl_player_id));
      const metricValues: Record<string, number | null> = {};
      for (const metric of FORUM_LEADERBOARD_METRICS) {
        const raw = metric.source === 'official'
          ? row[metric.field ?? metric.key]
          : screenshotStats?.metricValues[metric.key];
        const value = raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())
          ? null
          : Number(raw);
        metricValues[metric.key] = value !== null && Number.isFinite(value) ? value : null;
      }
      return {
        ...row,
        metricValues,
        metricSampleCounts: screenshotStats?.metricSampleCounts ?? {},
        rating_component_counts: screenshotStats?.ratingComponentCounts ?? {},
      };
    });
  const tourAverages = calculateTourMetricAverages(
    officialLeaderboardRows,
    screenshotRows,
    FORUM_LEADERBOARD_METRICS,
  );

  return (
    <>
      <PageHero eyebrow="WTSL TE4" title="Statistics">Match statistics and player performance, A–Z. Want players ranked by a stat instead? Check the <Link href="/leaderboard" style={{ color: 'var(--lime)' }}>Leaderboard</Link>.</PageHero>
      <main className="container">
        <div className="notice warn" style={{ marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 600 }}>
          <span>🚧</span>
          <span>These statistics are still under construction and may not reflect every match in the WTSL database yet. For the most complete and accurate numbers, use <code>/wtslstats</code> in Discord.</span>
        </div>
        <TourTabs basePath="/stats" current={tour} exclude={['TE4_Coop']} />
        <section className="stats-tour-averages panel" aria-labelledby="stats-tour-averages-title">
          <div className="panel-head">
            <h2 className="display" id="stats-tour-averages-title">Tour averages</h2>
            <span>All leaderboard metrics</span>
          </div>
          <p className="stats-tour-averages__note">
            Each average uses players eligible for that metric’s leaderboard. Screenshot metrics require at least {LEADERBOARD_MIN_MATCHES} screenshots; counts show how many players have a measured value.
          </p>
          <dl className="stats-tour-averages__grid">
            {tourAverages.map((metric) => (
              <div className="stats-tour-averages__item" key={metric.key}>
                <dt>
                  {metric.label}
                  <small>{metric.source === 'official' ? 'Official results' : 'Screenshot stats'}</small>
                </dt>
                <dd>
                  <strong>
                    {metric.average
                      ? formatLeaderboardMetric(metric.average.value, metric.valueFormat)
                      : '—'}
                  </strong>
                  <small>
                    {metric.average ? `${metric.average.playerCount} players` : 'No measured data'}
                  </small>
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-head"><h2 className="display">Player Statistics</h2></div>
            {rows.length === 0 ? <div className="empty"><strong>No stats yet</strong>Statistics fill in as matches are recorded.</div> : (
              <PlayerStatsTable rows={rows as any} tour={tour} />
            )}
          </section>
          <aside className="panel stats-recent-panel">
            <div className="panel-head"><h2 className="display">Recent matches</h2></div>
            {matches.length === 0 ? <div className="empty">No matches recorded yet.</div> : (
              <div className="stats-recent-list">
                {matches.map((m: any) => (
                  <div className="match-row" key={m.id}><div>{m.player_one_name}<br /><b>{m.score || '—'}</b><br />{m.player_two_name}</div><span>{lookupWtslTournamentName(m.tournament_key, tournamentNames) || lookupWtslTournamentName(m.tournament_name, tournamentNames) || m.tournament_name || m.tournament_key || ''}{m.round_name ? ` · ${m.round_name}` : ''}</span></div>
                ))}
              </div>
            )}
          </aside>
        </div>
        <p className="empty" style={{ marginTop: 20 }}>Only players with at least {LEADERBOARD_MIN_MATCHES} recorded matches are shown. Select any table header to sort it.</p>
      </main>
    </>
  );
}
