import type { Metadata } from 'next';
import Link from 'next/link';
import { safe } from '@/lib/db';
import { leaderboard, recentMatches, playerStats, recentlyCompletedPairs, LEADERBOARD_MIN_MATCHES } from '@/lib/stats';
import { openFixtures, excludeStaleFixtures } from '@/lib/betting';
import { getSession } from '@/lib/auth';
import { getClaimsForUser } from '@/lib/player-claims';
import { getContributionStats, getRecentActivity } from '@/lib/queries';
import { buildPlayerInsights, type PlayerInsightReport } from '@/lib/playerInsights';
import { tourLabel } from '@/lib/wtsl';
import { timeAgo } from '@/lib/format';
import PageHero from '@/components/PageHero';
import RatingEvidence from '@/components/RatingEvidence';
import {
  BOT_RATING_METRICS,
  botRatingStats,
  type BotRatingStatsRow,
} from '@/lib/botRatingLeaderboards';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Dashboard' };

type VerifiedPlayerCard = {
  tour: string;
  playerName: string;
  stats: any;
  insights: PlayerInsightReport;
  ratings: BotRatingStatsRow | null;
};

export default async function Dashboard() {
  const viewer = await safe(() => getSession(), null);

  if (!viewer) {
    const [players, matches, fx, completedAtp, completedWta] = await Promise.all([
      safe(() => leaderboard(), [] as any[]),
      safe(() => recentMatches(8), [] as any[]),
      safe(() => openFixtures(), [] as any[]),
      safe(() => recentlyCompletedPairs('TE4'), new Set<string>()),
      safe(() => recentlyCompletedPairs('TE4_(F)'), new Set<string>()),
    ]);
    const completedPairs = new Set<string>([...completedAtp, ...completedWta]);
    const fixtures = excludeStaleFixtures(Array.isArray(fx) ? fx : [], completedPairs);
    return (
      <>
        <PageHero eyebrow="WTSL Forum" title="Dashboard">Log in with Discord to see your own stats, forum activity and coaching insights here. Until then, here's a snapshot of the tour.</PageHero>
        <main className="container">
          <div className="empty-cta panel"><a className="btn btn-discord" href="/api/auth/discord">Log in with Discord</a></div>
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

  const [claims, contributions, activity] = await Promise.all([
    safe(() => getClaimsForUser(viewer.id), [] as any[]),
    safe(() => getContributionStats(viewer.id), { topics: 0, replies: 0, articles: 0 }),
    safe(() => getRecentActivity(viewer.id, 6), [] as any[]),
  ]);
  const approved = claims.filter((c: any) => c.status === 'approved');
  const pending = claims.filter((c: any) => c.status === 'pending');

  const playerCards: VerifiedPlayerCard[] = await Promise.all(
    approved.map(async (c: any) => {
      const [rows, ratingRows] = await Promise.all([
        safe(() => playerStats(c.wtsl_player_id), [] as any[]),
        safe(() => botRatingStats(c.tour, c.wtsl_player_id), [] as BotRatingStatsRow[]),
      ]);
      const stats = rows.find((r: any) => r.tour === c.tour) ?? rows[0] ?? {};
      const insights = await safe(() => buildPlayerInsights(c.wtsl_player_id, c.tour), {
        qualifies: false,
        groupPercentiles: { serve: null, return: null, rally: null },
        strongest: null,
        weakest: null,
        trainingFocus: null,
      } as PlayerInsightReport);
      return { tour: c.tour, playerName: c.player_name, stats, insights, ratings: ratingRows[0] ?? null };
    })
  );

  return (
    <>
      <PageHero eyebrow="Your dashboard" title={`Welcome back, ${viewer.username}`}>Your tour stats, forum activity and coaching insights, in one place.</PageHero>
      <main className="container">
        <div className="notice warn" style={{ marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 600 }}>
          <span>🚧</span>
          <span>These stats are still under construction and may not be fully accurate yet. For the most reliable numbers, use <code>/mystats</code> in Discord.</span>
        </div>

        <div className="kpi-grid">
          <div><span>Verified tours</span><b>{approved.length}</b></div>
          <div><span>Topics started</span><b>{contributions.topics}</b></div>
          <div><span>Replies posted</span><b>{contributions.replies}</b></div>
          <div><span>Articles written</span><b>{contributions.articles}</b></div>
        </div>

        {playerCards.length === 0 ? (
          <section className="panel">
            <div className="panel-head"><h2 className="display">Your tour stats</h2></div>
            <div className="empty">
              {pending.length > 0
                ? 'Your player verification is awaiting admin review — your stats will show up here once approved.'
                : <>You haven&apos;t verified a player profile yet. Head to <Link href="/profile">your profile</Link> to link your Discord account to your WTSL player (see <Link href="/about">Get started</Link> for how it works).</>}
            </div>
          </section>
        ) : (
          playerCards.map((card) => {
            const p = card.stats;
            const form: string = p.form ?? '';
            return (
              <section className="panel" key={card.tour}>
                <div className="panel-head">
                  <h2 className="display">{card.playerName} <span className="pill cyan">{tourLabel(card.tour)}</span></h2>
                  <Link href={`/players/${p.wtsl_player_id}?tour=${encodeURIComponent(card.tour)}`}>Full profile →</Link>
                </div>
                <div className="player-record-grid">
                  <div><strong>{p.wins ?? 0}-{p.losses ?? 0}</strong><small>Career record</small></div>
                  <div><strong>{p.matches > 0 ? Math.round((100 * (p.wins ?? 0)) / p.matches) : 0}%</strong><small>Win %</small></div>
                  <div><strong>{p.tour_elo ?? '—'}</strong><small>Tour Elo</small></div>
                  <div><strong>{p.rank ? `#${p.rank}` : '—'}</strong><small>Rank</small></div>
                </div>
                {form && (
                  <div className="player-form-row">
                    <small>Recent form</small>
                    <div>{form.split('').map((c, i) => <span key={i} className={c === 'W' ? 'form-win' : 'form-loss'}>{c}</span>)}</div>
                  </div>
                )}
                {p.clutch_stats_source === 'wtsl_all_results'
                  && ((p.sets_won ?? 0) > 0 || (p.sets_lost ?? 0) > 0 || (p.tiebreaks_played ?? 0) > 0 || (p.deciding_sets_played ?? 0) > 0) && (
                  <div className="player-record-grid">
                    <div><strong>{p.sets_won ?? 0}-{p.sets_lost ?? 0}</strong><small>Sets · official WTSL results</small></div>
                    <div><strong>{p.tiebreaks_won ?? 0}-{(p.tiebreaks_played ?? 0) - (p.tiebreaks_won ?? 0)}</strong><small>Tiebreaks</small></div>
                    <div><strong>{p.deciding_sets_won ?? 0}-{(p.deciding_sets_played ?? 0) - (p.deciding_sets_won ?? 0)}</strong><small>Deciding sets</small></div>
                    {card.tour === 'TE4' && p.favorite_character && (
                      <div><strong>{p.favorite_character}</strong><small>Favourite character ({p.favorite_character_picks}/{p.character_matches})</small></div>
                    )}
                  </div>
                )}
                <div className="player-record-grid">
                  {card.ratings ? BOT_RATING_METRICS.map((metric) => {
                    const value = card.ratings?.ratings[metric.key] ?? null;
                    return (
                      <div key={metric.key}>
                        <strong>{value == null ? '—' : value.toFixed(1)}</strong>
                        <small>{metric.label} rating</small>
                        {value != null && <RatingEvidence metric={metric.key} counts={card.ratings?.ratingComponentCounts} />}
                      </div>
                    );
                  }) : (
                    <div className="empty">Serve, Return and Under Pressure ratings appear after at least {LEADERBOARD_MIN_MATCHES} eligible screenshot matches are available.</div>
                  )}
                </div>
                {card.insights.qualifies ? (
                  <div className="insight-grid">
                    {card.insights.strongest && (
                      <div className="insight-card insight-strength">
                        <small>Strength — {card.insights.strongest.label}</small>
                        <p>{card.insights.strongest.commentary}</p>
                        <p className="insight-standing">Your field standing is {card.insights.strongest.standing}.</p>
                        <p className="insight-tactic">{card.insights.strongest.tactic}</p>
                      </div>
                    )}
                    {card.insights.weakest && (
                      <div className="insight-card insight-development">
                        <small>Development focus — {card.insights.weakest.label}</small>
                        <p>{card.insights.weakest.commentary}</p>
                        <p className="insight-standing">Your field standing is {card.insights.weakest.standing}.</p>
                        <p className="insight-tactic">{card.insights.weakest.tactic}</p>
                      </div>
                    )}
                    {card.insights.trainingFocus && <div className="insight-training"><small>Training focus</small><p>{card.insights.trainingFocus}</p></div>}
                  </div>
                ) : (
                  <div className="empty">No screenshot-based stat samples are available for this player yet. Field comparisons appear when the bot has at least one valid stat sample for this tour.</div>
                )}
              </section>
            );
          })
        )}

        <section className="panel">
          <div className="panel-head"><h2 className="display">Your recent forum activity</h2></div>
          {activity.length === 0 ? <div className="empty">No topics or replies yet — jump into <Link href="/discussions">Discussions</Link> to get started.</div> : activity.map((a: any) => (
            <div className="match-row" key={`${a.kind}-${a.id}-${a.created_at}`}>
              <div>{a.kind === 'topic' ? 'Started' : 'Replied to'} <Link href={`/discussions/${a.id}`}><b>{a.title}</b></Link></div>
              <span>{timeAgo(a.created_at)}</span>
            </div>
          ))}
        </section>
      </main>
    </>
  );
}
