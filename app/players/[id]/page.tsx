import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { safe, sql } from '@/lib/db';
import { playerStats } from '@/lib/stats';
import { getVerifiedOwner } from '@/lib/player-claims';
import { getContributionStats } from '@/lib/queries';
import { discordAvatar, getSession } from '@/lib/auth';
import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { StatusDot } from '@/components/StatusDot';
import { DEFAULT_TOUR, getTourEloDesignation, isTourCode, tourLabel, type TourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tour?: string }> };

function membershipDuration(createdAt: string | Date): string {
  const joined = new Date(createdAt);
  if (!Number.isFinite(joined.getTime())) return '—';
  const now = new Date();
  let months = (now.getFullYear() - joined.getFullYear()) * 12 + now.getMonth() - joined.getMonth();
  if (now.getDate() < joined.getDate()) months -= 1;
  months = Math.max(0, months);
  if (months === 0) {
    const days = Math.max(0, Math.floor((now.getTime() - joined.getTime()) / 86_400_000));
    return days < 1 ? 'less than a day' : `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  return [
    years ? `${years} ${years === 1 ? 'year' : 'years'}` : '',
    remainingMonths ? `${remainingMonths} ${remainingMonths === 1 ? 'month' : 'months'}` : '',
  ].filter(Boolean).join(' ');
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const rows = await safe(() => playerStats(id), [] as any[]);
  return { title: rows[0]?.name ?? 'Player' };
}

export default async function PlayerDashboard({ params, searchParams }: Props) {
  const { id } = await params;
  const { tour: tourParam } = await searchParams;
  const rows = await safe(() => playerStats(id), [] as any[]);
  if (rows.length === 0) notFound();

  const tours = rows.map((r: any) => r.tour).filter(Boolean);
  const tour: TourCode = isTourCode(tourParam) && tours.includes(tourParam) ? tourParam : (isTourCode(tours[0]) ? tours[0] : DEFAULT_TOUR);
  const p = rows.find((r: any) => r.tour === tour) ?? rows[0];
  const eloLabel = p.tour_elo == null ? p.elo_label : getTourEloDesignation(p.tour_elo);

  const recent = await safe(() => sql`
    SELECT r.*
    FROM player_recent_results r
    WHERE r.player_id=${id} AND r.tour=${tour}
      AND (
        ${tour} <> 'TE4_(F)'
        OR EXISTS (
          SELECT 1
          FROM tournaments t
          WHERE t.tour='TE4_(F)'
            AND (
              t.wtsl_tournament_key=r.tournament_key
              OR (regexp_match(t.official_url, '[?&]tournament=([^&]+)'))[1]=r.tournament_key
            )
        )
      )
    ORDER BY r.position ASC
    LIMIT 10
  `, [] as any[]);
  const verifiedOwner = await safe(() => getVerifiedOwner(id, tour), null as any);
  const viewer = await safe(() => getSession(), null);
  const forumContributions = verifiedOwner
    ? await safe(() => getContributionStats(String(verifiedOwner.id)), { topics: 0, replies: 0, articles: 0 })
    : null;
  const forumPostCount = forumContributions
    ? Number(forumContributions.topics) + Number(forumContributions.replies)
    : 0;

  const form: string = p.form ?? '';
  const statLines: { label: string; value: string | number }[] = [
    { label: 'First serve %', value: `${p.first_serve_pct ?? 0}%` },
    { label: 'Avg aces', value: p.aces ?? 0 },
    { label: 'Avg double faults', value: p.avg_double_faults ?? 0 },
    { label: 'Avg 1st serve speed', value: p.avg_first_serve_speed ?? 0 },
    { label: 'Avg 2nd serve speed', value: p.avg_second_serve_speed ?? 0 },
    { label: 'Avg net points %', value: `${p.avg_net_points_pct ?? 0}%` },
    { label: 'Avg winners', value: p.winners ?? 0 },
    { label: 'Avg forced errors', value: p.avg_forced_errors ?? 0 },
    { label: 'Avg unforced errors', value: p.avg_unforced_errors ?? 0 },
    { label: 'Breakpoint conversion %', value: `${p.break_points_won ?? 0}%` },
    { label: 'Short rallies won %', value: `${p.avg_short_rally_pct ?? 0}%` },
    { label: 'Medium rallies won %', value: `${p.avg_medium_rally_pct ?? 0}%` },
    { label: 'Long rallies won %', value: `${p.avg_long_rally_pct ?? 0}%` },
    { label: '1st serve points won %', value: `${p.avg_first_serve_won_pct ?? 0}%` },
    { label: '2nd serve points won %', value: `${p.avg_second_serve_won_pct ?? 0}%` },
    { label: 'Return points won %', value: `${p.avg_return_won_pct ?? 0}%` },
    { label: 'Avg rally length', value: p.avg_rally_length ?? 0 },
  ];

  return (
    <>
      <PageHero eyebrow="Player" title={p.name}>{tourLabel(tour)}{p.country ? ` · ${p.country}` : ''}</PageHero>
      <main className="page-shell" style={{ paddingTop: 10 }}>
        {tours.length > 1 && (
          <div className="tour-tabs" role="tablist" aria-label="Tour">
            {tours.map((t: string) => (
              <Link key={t} href={`/players/${id}?tour=${encodeURIComponent(t)}`} className={`tour-tab${t === tour ? ' active' : ''}`} aria-selected={t === tour} role="tab">
                {tourLabel(t)}
              </Link>
            ))}
          </div>
        )}
        <div className="player-dash-head panel">
          {p.avatar_url ? <img src={p.avatar_url} alt={p.name} className="player-dash-avatar" /> : <div className="player-placeholder">{(p.name || 'W')[0]}</div>}
          <div>
            <h2 className="display">{p.name}</h2>
            {p.country && <p>{p.flag_url && <img src={p.flag_url} alt="" style={{ height: 14, marginRight: 6 }} />}{p.country}</p>}
            <p>Tour Rank <b>{p.rank ? `#${p.rank}` : 'Unranked'}</b> | Tour Elo <b>{p.tour_elo ?? '—'}</b>{eloLabel ? ` (${eloLabel})` : ''}</p>
            {p.official_url && <a href={p.official_url} target="_blank" rel="noreferrer">View WTSL profile ↗</a>}
            {verifiedOwner && (
              <p style={{ marginTop: 8 }}>
                <span className="pill cyan">Verified account</span>{' '}
                <img src={discordAvatar(verifiedOwner.avatar_url, verifiedOwner.display_name)} alt="" style={{ width: 20, height: 20, borderRadius: '50%', verticalAlign: 'middle', marginRight: 4 }} />
                <StatusDot status={verifiedOwner.status} /> {verifiedOwner.display_name}
                {viewer && Number(verifiedOwner.id) !== Number(viewer.id) && (
                  <> · <Link href={`/messages/${verifiedOwner.id}`}>Message</Link></>
                )}
              </p>
            )}
            {verifiedOwner && forumContributions && (
              <div aria-label="Forum account activity" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 8, color: 'var(--muted)', fontSize: 13 }}>
                <span title="Discussion starters and replies authored"><b>{forumPostCount.toLocaleString()}</b> forum posts</span>
                <span>Member for <b>{membershipDuration(verifiedOwner.created_at)}</b></span>
              </div>
            )}
          </div>
        </div>
        <div className="dashboard-grid">
          <section className="panel">
            <div className="panel-head"><h2 className="display">Win / loss record</h2></div>
            <div className="player-record-grid">
              <div><strong>{p.wins ?? 0}-{p.losses ?? 0}</strong><small>Career</small></div>
              <div><strong>{p.matches > 0 ? Math.round((100 * (p.wins ?? 0)) / p.matches) : 0}%</strong><small>Career win %</small></div>
              <div><strong>{p.ytd_wins ?? 0}-{p.ytd_losses ?? 0}</strong><small>YTD</small></div>
              <div><strong>{p.ytd_win_pct ?? 0}%</strong><small>YTD win %</small></div>
              <div><strong>{p.titles_main ?? 0}</strong><small>Titles (Main Tour)</small></div>
              <div><strong>{p.finals_main ?? 0}</strong><small>Finals (Main Tour)</small></div>
              <div><strong>{p.prize_money ? `${Number(p.prize_money).toLocaleString()} ${p.prize_currency || ''}` : '—'}</strong><small>Career prize money</small></div>
            </div>
            {form && (
              <div className="player-form-row">
                <small>Form (last {form.length})</small>
                <div>{form.split('').map((c, i) => <span key={i} className={c === 'W' ? 'form-win' : 'form-loss'}>{c}</span>)}</div>
              </div>
            )}
          </section>
          <aside className="panel">
            <div className="panel-head"><h2 className="display">Recent results</h2></div>
            {recent.length === 0 ? <div className="empty">No recent results synced yet.</div> : recent.map((r: any) => (
              <div className="match-row" key={r.id}>
                <div>{r.tournament_name}<br /><b>{r.score || '—'}</b><br />vs {r.opponent_name}</div>
                <span>{r.round_name}{r.played_at ? ` · ${new Date(r.played_at).toLocaleDateString()}` : ''}</span>
              </div>
            ))}
          </aside>
        </div>
        <section className="panel">
          <div className="panel-head"><h2 className="display">Match Statistics</h2></div>
          <div className="player-stat-grid">
            {statLines.map((s) => (
              <div key={s.label}><small>{s.label}</small><strong>{s.value}</strong></div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
