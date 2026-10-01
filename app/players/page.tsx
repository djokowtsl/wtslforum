import type { Metadata } from 'next';
import { safe, sql } from '@/lib/db';
import PageHero from '@/components/PageHero';
import TourTabs from '@/components/TourTabs';
import { DEFAULT_TOUR, isTourCode, tourLabel, type TourCode } from '@/lib/wtsl';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Players' };

export default async function PlayersPage({ searchParams }: { searchParams: Promise<{ tour?: string }> }) {
  const { tour: tourParam } = await searchParams;
  const tour: TourCode = isTourCode(tourParam) ? tourParam : DEFAULT_TOUR;
  const players = await safe(() => sql`SELECT * FROM wtsl_players WHERE tour=${tour} ORDER BY rank ASC NULLS LAST,tour_elo DESC NULLS LAST,name LIMIT 200`, [] as any[]);
  return (
    <>
      <PageHero eyebrow="Players" title="Players" />
      <main className="page-shell" style={{ paddingTop: 10 }}>
        <TourTabs basePath="/players" current={tour} />
        {players.length === 0 ? (
          <div className="forum-list"><div className="empty"><strong>No players synced yet</strong>Players appear here once the WTSL {tourLabel(tour)} rankings sync has run.</div></div>
        ) : (
          <div className="player-grid">
            {players.map((p: any) => (
              <a className="player-card" href={`/players/${p.wtsl_player_id}?tour=${encodeURIComponent(tour)}`} key={p.wtsl_player_id}>
                {p.avatar_url ? <img src={p.avatar_url} alt={p.name} /> : <div className="player-placeholder">{(p.name || 'W')[0]}</div>}
                <div><strong>{p.name}</strong>{p.country && <small>{p.flag_url && <img src={p.flag_url} alt="" />}{p.country}</small>}<b>{p.rank ? `#${p.rank} · ` : ''}Tour Elo {p.tour_elo ?? '—'}</b></div>
                <span>↗</span>
              </a>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
