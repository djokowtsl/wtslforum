import Link from 'next/link';
import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { getArticles } from '@/lib/queries';
import { fmtDate } from '@/lib/format';
import PageHero from '@/components/PageHero';
import ForumRoleBadges from '@/components/ForumRoleBadges';
import { getForumRoleBadgeMap, type ForumRoleBadge } from '@/lib/forumRoles';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Articles' };

export default async function Articles() {
  const articles = await safe(() => getArticles(), [] as any[]);
  const roleBadgeMap = await safe(
    () => getForumRoleBadgeMap(articles.map((article: any) => article.author_id)),
    new Map<string, ForumRoleBadge[]>(),
  );
  return (
    <>
      <PageHero eyebrow="WTSL Editorial" title="Articles">Long-form stories, match reports, features and community writing from around the tour.</PageHero>
      <main className="container">
        {articles.length === 0 ? (
          <div className="forum-list"><div className="empty"><strong>No stories published yet</strong>Match reports, features and community writing will live here.</div></div>
        ) : (
          <div className="article-grid">
            {articles.map((a: any) => (
              <Link href={'/articles/' + a.slug} className="article" key={a.id}>
                <div className="article-cover" style={a.cover_url ? { backgroundImage: `linear-gradient(0deg,rgba(3,10,24,.6),transparent),url(${a.cover_url})` } : undefined}></div>
                <div className="article-body">
                  <h3>{a.title}</h3>
                  {a.excerpt && <p>{a.excerpt}</p>}
                  <div className="article-author-meta">
                    <small>{a.author || 'WTSL Forum'} · {fmtDate(a.created_at)}</small>
                    <ForumRoleBadges roles={roleBadgeMap.get(String(a.author_id)) || []} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
