import { redirect } from 'next/navigation';
import { safe } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getArticles, getTopics } from '@/lib/queries';
import { listClaims } from '@/lib/player-claims';
import AdminArticleForm from '@/components/AdminArticleForm';
import AdminSyncButton from '@/components/AdminSyncButton';
import PageHero from '@/components/PageHero';

export const dynamic = 'force-dynamic';

export default async function Admin() {
  const u = await getSession();
  if (!u) redirect('/api/auth/discord');
  if (!u.isAdmin) redirect('/');
  const [articles, topics, pendingClaims] = await Promise.all([
    safe(() => getArticles(false), [] as any[]),
    safe(() => getTopics(), [] as any[]),
    safe(() => listClaims('pending'), [] as any[]),
  ]);
  return (
    <>
      <PageHero eyebrow="Staff" title="Admin">Moderation and community publishing.</PageHero>
      <main className="container">
        <div className="admin-grid">
          <div className="admin-card"><h3>Create article</h3><AdminArticleForm /></div>
          <div className="admin-card"><h3>Forum overview</h3><div className="stat"><span>Discussions</span><b>{topics.length}</b></div><div className="stat"><span>Articles</span><b>{articles.length}</b></div><p className="notice" style={{ marginTop: 14 }}>Manage community content and staff access.</p><a className="btn btn-sm" href="/admin/moderation" style={{ marginTop: 12, display: 'inline-block' }}>Moderation queue</a><a className="btn btn-sm btn-ghost" href="/admin/roles" style={{ marginTop: 12, marginLeft: 8, display: 'inline-block' }}>Account roles</a></div>
          <div className="admin-card"><h3>Awards</h3><p className="notice">Manage this season&apos;s award nominees, open or close voting, and import Google Form responses.</p><a className="btn btn-sm" href="/admin/awards" style={{ marginTop: 12, display: 'inline-block' }}>Manage awards</a></div>
          <div className="admin-card"><h3>WTSL sync</h3><p className="notice">Players, tournaments and stats sync automatically every hour/day. Use this to force a sync right now.</p><AdminSyncButton /></div>
          <div className="admin-card"><h3>Player verification</h3><p className="notice">{pendingClaims.length} pending request{pendingClaims.length === 1 ? '' : 's'} linking a Discord account to a WTSL player.</p><a className="btn btn-sm" href="/admin/claims" style={{ marginTop: 12, display: 'inline-block' }}>Review requests</a></div>
        </div>
      </main>
    </>
  );
}
