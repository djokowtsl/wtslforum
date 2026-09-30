import Link from 'next/link';
import { notFound } from 'next/navigation';
import { safe, sql } from '@/lib/db';
import { getTournament } from '@/lib/tournaments';
import { recentMatches } from '@/lib/stats';
import { ResultCard } from '@/components/MatchCards';

export const dynamic = 'force-dynamic';

export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t: any = await safe(() => getTournament(slug), null as any);
  if (!t) notFound();
  const [champion, topic, matches] = await Promise.all([
    t.champion_player_id ? safe(async () => (await sql`SELECT * FROM wtsl_players WHERE wtsl_player_id=${t.champion_player_id} LIMIT 1`)[0], null as any) : null,
    t.discussion_topic_id ? safe(async () => (await sql`SELECT id FROM topics WHERE id=${t.discussion_topic_id}`)[0], null as any) : null,
    safe(() => recentMatches(200), [] as any[]),
  ]);
  const mine = matches.filter((m: any) => m.tournament_key === t.wtsl_tournament_key).slice(0, 12);

  return (
    <main className="page-shell">
      <Link href="/tournaments" className="back-link">← All tournaments</Link>
      <div className="tournament-hero">
        <div className={`status-pill ${t.status}`}>{t.status}</div>
        <div className="eyebrow">{t.category}</div>
        <h1 className="display">{t.name}</h1>
        <p className="hero-meta">{t.location}{t.country ? `, ${t.country}` : ''} · {t.surface} · {t.draw_size ?? '—'}-player draw</p>
        {champion && (
          <div className="champion-player">
            {champion.avatar_url && <img src={champion.avatar_url} alt={champion.name} />}
            <div><span>Champion</span><strong>{champion.name}</strong><small>{champion.flag_url && <img src={champion.flag_url} alt="" />}{champion.country} · Tour Elo {champion.tour_elo ?? '—'}</small></div>
          </div>
        )}
        <div className="hero-actions">
          {topic && <Link className="btn btn-primary" href={`/discussions/${topic.id}`}>💬 Tournament discussion</Link>}
          <a className="btn" href={t.official_url} target="_blank" rel="noreferrer">Official WTSL page ↗</a>
        </div>
      </div>
      {mine.length > 0 && (
        <section className="section-block">
          <div className="section-heading"><h2>Results</h2><span>{mine.length}</span></div>
          <div className="live-grid">{mine.map((m: any) => <ResultCard key={m.id} m={m} tournamentNames={{ [t.wtsl_tournament_key]: t.name }} />)}</div>
        </section>
      )}
    </main>
  );
}
