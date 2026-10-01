import Link from 'next/link';
import type { Metadata } from 'next';
import { dbConfigured, safe } from '@/lib/db';
import { getTopics, getCategoriesWithCounts } from '@/lib/queries';
import { getSession, discordAvatar } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Discussions' };

export default async function Discussions({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const [u, topics, cats] = await Promise.all([
    getSession(),
    safe(() => getTopics({ category: c }), [] as any[]),
    safe(() => getCategoriesWithCounts(), [] as any[]),
  ]);
  const active = cats.find((x: any) => x.slug === c);
  const total = cats.reduce((n: number, x: any) => n + x.topics, 0);

  return (
    <>
      <PageHero
        eyebrow="WTSL Community Forum"
        title={active ? active.name : 'Discussions'}
        actions={u ? <Link className="btn btn-primary" href="/discussions/new">New discussion</Link> : <a className="btn btn-discord" href="/api/auth/discord">Join with Discord</a>}
      >
        {active?.description || 'Match talk, tournament threads, history and everything else happening around the league.'}
      </PageHero>
      <main className="container">
        {!dbConfigured() && <div className="notice warn" style={{ marginBottom: 20 }}>The forum database is not connected on this deployment (<code>DATABASE_URL</code> is missing).</div>}
        {cats.length > 0 && (
          <div className="chips">
            <Link className={`chip ${!c ? 'active' : ''}`} href="/discussions">All<small>{total}</small></Link>
            {cats.map((x: any) => <Link key={x.id} className={`chip ${c === x.slug ? 'active' : ''}`} href={'/discussions?c=' + x.slug}>{x.name}<small>{x.topics}</small></Link>)}
          </div>
        )}
        <section className="forum-list">
          <div className="category-head">{active ? active.name : 'All discussions'}<small>{topics.length} {topics.length === 1 ? 'thread' : 'threads'}</small></div>
          {topics.length === 0 ? (
            <div className="empty"><strong>Nothing here yet</strong>Start the first conversation in this board.{u && <><br /><Link className="btn btn-primary btn-sm" href="/discussions/new">Start a discussion</Link></>}</div>
          ) : topics.map((t: any) => (
            <Link className="topic" href={'/discussions/' + t.id} key={t.id}>
              <img className="av" src={t.tournament_logo || (!t.author ? '/brand/wtsl-logo-200.png' : discordAvatar(t.avatar, t.author || 'W'))} alt="" />
              <div>
                <div className="topic-title">{t.title}</div>
                <div className="topic-meta">
                  {t.pinned && <span className="pill pin">Pinned</span>}
                  {t.locked && <span className="pill cyan">Locked</span>}
                  {t.category && <span className="pill">{t.category}</span>}
                  <span>{t.author || 'Community'}</span><span>{timeAgo(t.created_at)}</span>
                </div>
              </div>
              <div className="topic-stat">{t.replies}<span>replies</span></div>
              <div className="topic-last">{t.last_author ? <><b>{t.last_author}</b>{timeAgo(t.last_reply_at)}</> : <span>No replies yet</span>}</div>
            </Link>
          ))}
        </section>
      </main>
    </>
  );
}
