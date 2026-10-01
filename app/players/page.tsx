import type { Metadata } from 'next';
import { safe, sql } from '@/lib/db';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Players' };

export default async function PlayersPage() {
  const players = await safe(() => sql`SELECT * FROM wtsl_players ORDER BY rank ASC NULLS LAST,tour_elo DESC NULLS LAST,name LIMIT 200`, [] as any[]);
  return (
    <>
      <PageHero eyebrow="Players" title="Players" />
      <main className="page-shell" style={{ paddingTop: 10 }}>
        {players.length === 0 ? (
          <div className="forum-list"><div className="empty"><strong>No players synced yet</strong>Players appear here once the WTSL rankings sync has run.</div></div>
        ) : (
          <div className="player-grid">
            {players.map((p: any) => (
              <a className="player-card" href={p.official_url} target="_blank" rel="noreferrer" key={p.wtsl_player_id}>
                {p.avatar_url ? <img src={p.avatar_url} alt={p.name} /> : <div className="player-placeholder">{(p.name || 'W')[0]}</div>}
                <div><strong>{p.name}</strong><small>{p.flag_url && <img src={p.flag_url} alt="" />}{p.country || 'WTSL Player'}</small><b>{p.rank ? `#${p.rank} · ` : ''}Tour Elo {p.tour_elo ?? '—'}</b></div>
                <span>↗</span>
              </a>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
