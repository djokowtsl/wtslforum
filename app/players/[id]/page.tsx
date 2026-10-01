import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { safe, sql } from '@/lib/db';
import { playerStats } from '@/lib/stats';
import { getVerifiedOwner } from '@/lib/player-claims';
import { discordAvatar } from '@/lib/auth';
import Link from 'next/link';
import PageHero from '@/components/PageHero';
import { DEFAULT_TOUR, isTourCode, tourLabel, type TourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tour?: string }> };

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

  const recent = await safe(() => sql`SELECT * FROM player_recent_results WHERE player_id=${id} AND tour=${tour} ORDER BY position ASC LIMIT 10`, [] as any[]);
  const verifiedOwner = await safe(() => getVerifiedOwner(id, tour), null as any);

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
      <PageHero eyebrow="Player" title={p.name}>{tourLabel(tour)} · {p.country || 'WTSL Player'}</PageHero>
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
            <p>{p.flag_url && <img src={p.flag_url} alt="" style={{ height: 14, marginRight: 6 }} />}{p.country || 'WTSL Player'}</p>
            <p><b>{p.rank ? `#${p.rank}` : 'Unranked'}</b> · Tour Elo <b>{p.tour_elo ?? '—'}</b>{p.elo_label ? ` (${p.elo_label})` : ''}</p>
            {p.official_url && <a href={p.official_url} target="_blank" rel="noreferrer">View official WTSL profile ↗</a>}
            {verifiedOwner && (
              <p style={{ marginTop: 8 }}>
                <span className="pill cyan">Verified account</span>{' '}
                <img src={discordAvatar(verifiedOwner.avatar_url, verifiedOwner.display_name)} alt="" style={{ width: 20, height: 20, borderRadius: '50%', verticalAlign: 'middle', marginRight: 4 }} />
                {verifiedOwner.display_name}
              </p>
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
          <div className="panel-head"><h2 className="display">Match averages</h2></div>
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
