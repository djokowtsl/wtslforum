import { redirect } from 'next/navigation';
import { safe } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getArticles, getTopics } from '@/lib/queries';
import AdminArticleForm from '@/components/AdminArticleForm';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';

export default async function Admin() {
  const u = await getSession();
  if (!u) redirect('/api/auth/discord');
  if (!u.isAdmin) redirect('/');
  const [articles, topics] = await Promise.all([safe(() => getArticles(false), [] as any[]), safe(() => getTopics(), [] as any[])]);
  return (
    <>
      <PageHero eyebrow="Staff" title="Admin">Moderation and community publishing.</PageHero>
      <main className="container">
        <div className="admin-grid">
          <div className="admin-card"><h3>Create article</h3><AdminArticleForm /></div>
          <div className="admin-card"><h3>Forum overview</h3><div className="stat"><span>Discussions</span><b>{topics.length}</b></div><div className="stat"><span>Articles</span><b>{articles.length}</b></div><p className="notice" style={{ marginTop: 14 }}>Additional moderation controls can be added here as the community grows.</p></div>
        </div>
      </main>
    </>
  );
}
