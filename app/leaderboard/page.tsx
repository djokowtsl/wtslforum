import type { Metadata } from 'next';
import Link from 'next/link';
import { safe } from '@/lib/db';
import { leaderboard, LEADERBOARD_MIN_MATCHES } from '@/lib/stats';
import {
  BOT_AGGREGATE_METRICS,
  BOT_METRICS,
  BOT_RATING_METRICS,
  botLeaderboard,
  isBotMetric,
  type BotMetric,
} from '@/lib/botRatingLeaderboards';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import { DEFAULT_TOUR, isTourCode, type TourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Leaderboard' };

type ForumMetric = 'wins' | 'win_pct' | 'elo' | 'aces' | 'winners' | 'break_points' | 'first_serve_pct';
type MetricKey = ForumMetric | BotMetric;

const FORUM_METRICS: { key: ForumMetric; label: string }[] = [
  { key: 'wins', label: 'Wins' },
  { key: 'win_pct', label: 'Win %' },
  { key: 'elo', label: 'Tour Elo' },
  { key: 'aces', label: 'Aces' },
  { key: 'winners', label: 'Winners' },
  { key: 'break_points', label: 'Break points won' },
  { key: 'first_serve_pct', label: '1st serve %' },
];

const VALUE_COLUMN: Record<ForumMetric, { label: string; render: (p: any) => string | number }> = {
  wins: { label: 'Wins', render: (p) => p.wins },
  win_pct: { label: 'Win %', render: (p) => `${p.win_pct}%` },
  elo: { label: 'Tour Elo', render: (p) => p.tour_elo ?? '—' },
  aces: { label: 'Aces', render: (p) => p.aces },
  winners: { label: 'Winners', render: (p) => p.winners },
  break_points: { label: 'Break points won', render: (p) => p.break_points_won },
  first_serve_pct: { label: '1st serve %', render: (p) => `${p.first_serve_pct}%` },
};

function formatBotValue(value: number, metric: BotMetric) {
  const definition = BOT_METRICS.find((item) => item.key === metric)!;
  if (definition.valueFormat === 'rating') return Math.round(value);
  if (definition.valueFormat === 'percent') {
    return `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`;
  }
  return Number.isInteger(value) ? value : Number(value.toFixed(1));
}

function formatCharacterShare(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

export default async function Leaderboard({ searchParams }: { searchParams: Promise<{ tour?: string; metric?: string }> }) {
  const { tour: tourParam, metric: metricParam } = await searchParams;
  const tour: TourCode = isTourCode(tourParam) ? tourParam : DEFAULT_TOUR;
  const metric: MetricKey = FORUM_METRICS.some((item) => item.key === metricParam) || isBotMetric(metricParam ?? '')
    ? metricParam as MetricKey
    : 'wins';
  const selectedBotMetric = isBotMetric(metric);
  const botMetric = selectedBotMetric ? metric as BotMetric : null;
  const botDefinition = botMetric ? BOT_METRICS.find((item) => item.key === botMetric)! : null;
  const valueLabel = botDefinition?.label ?? VALUE_COLUMN[metric as ForumMetric].label;

  const rows = await safe(async () => {
    if (botMetric) {
      const aggregateRows = await botLeaderboard(tour, botMetric);
      return aggregateRows
        .filter((row) => row.matches >= LEADERBOARD_MIN_MATCHES)
        .map((row) => ({
          wtsl_player_id: row.playerId,
          name: row.player,
          avatar_url: null,
          country: '',
          matches: row.matches,
          value: row.value,
          favorite_character: row.favoriteCharacter,
          favorite_character_count: row.favoriteCharacterCount,
          favorite_character_percentage: row.favoriteCharacterPercentage,
        }));
    }
    return leaderboard(tour, metric as ForumMetric);
  }, [] as any[]);

  return (
    <>
      <PageHero eyebrow="WTSL TE4" title="Leaderboard">
        Players are ranked by the selected statistic. Forum match statistics and Discord bot spreadsheet aggregates are separate sources; spreadsheet leaderboards use player-level summaries only, not match-by-match rows. Each board requires at least {LEADERBOARD_MIN_MATCHES} matches.
      </PageHero>
      <main className="container">
        <TourTabs basePath="/leaderboard" current={tour} extraParams={{ metric }} />
        <div className="section-head">
          <div><h2 className="display">Forum statistics</h2><span>{LEADERBOARD_MIN_MATCHES}+ recorded matches</span></div>
          <div className="tabs-scroll">
            {FORUM_METRICS.map((item) => (
              <Link key={item.key} className={`tour-tab${item.key === metric ? ' active' : ''}`} href={`/leaderboard?tour=${encodeURIComponent(tour)}&metric=${encodeURIComponent(item.key)}`}>{item.label}</Link>
            ))}
          </div>
        </div>
        <section className="section-head">
          <div>
            <h2 className="display">Discord bot spreadsheet aggregates</h2>
            <span>Player-level summaries synced from the master spreadsheet</span>
          </div>
          <form method="get" className="tabs-scroll">
            <input type="hidden" name="tour" value={tour} />
            <label htmlFor="bot-metric">Choose an aggregate</label>
            <select id="bot-metric" name="metric" defaultValue={botMetric ?? ''}>
              <option value="" disabled>Choose a spreadsheet metric</option>
              <optgroup label="Overall ratings">
                {BOT_RATING_METRICS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </optgroup>
              <optgroup label="Aggregated spreadsheet metrics">
                {BOT_AGGREGATE_METRICS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </optgroup>
            </select>
            <button type="submit">View</button>
          </form>
        </section>
        <div className="section-head">
          <div>
            <h2 className="display">Ranked by {valueLabel.toLowerCase()}</h2>
            <span>{botMetric
              ? `${LEADERBOARD_MIN_MATCHES}+ screenshot matches · ${botDefinition?.direction === 'asc' ? 'lowest first' : 'highest first'} · bot spreadsheet aggregate`
              : `${LEADERBOARD_MIN_MATCHES}+ recorded matches · highest first · forum statistics`}</span>
          </div>
        </div>
        <section className="panel">
          {rows.length === 0 ? <div className="empty"><strong>{botMetric ? 'No spreadsheet data yet' : 'No stats yet'}</strong>{botMetric ? 'Aggregated values appear after the Discord bot syncs its leaderboard. Match-by-match rows are not imported into this board.' : 'The leaderboard fills in as forum statistics are recorded.'}</div> : (
            <div className="table-scroll">
              <table>
                <thead><tr>
                  <th>#</th><th>Player</th><th>Matches</th><th>{valueLabel}</th>
                  {botMetric && <th>Favourite character</th>}
                </tr></thead>
                <tbody>{rows.map((player: any, index: number) => {
                  const formattedValue = botMetric
                    ? formatBotValue(Number(player.value), botMetric)
                    : VALUE_COLUMN[metric as ForumMetric].render(player);
                  const characterShare = formatCharacterShare(player.favorite_character_percentage ?? null);
                  return (
                    <tr key={player.wtsl_player_id}>
                      <td>{index + 1}</td>
                      <td><a className="player-line" href={`/players/${encodeURIComponent(player.wtsl_player_id)}?tour=${encodeURIComponent(tour)}`}>{player.avatar_url && <img src={player.avatar_url} alt="" />}<span>{player.name}<small>{player.country || ''}</small></span></a></td>
                      <td>{player.matches}</td>
                      <td>{formattedValue}</td>
                      {botMetric && <td>{player.favorite_character ? <>{player.favorite_character}<small>{player.favorite_character_count ?? 0} picks{characterShare ? ` · ${characterShare}` : ''}</small></> : '—'}</td>}
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