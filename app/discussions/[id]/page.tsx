import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { getTopic } from '@/lib/queries';
import { getSession, discordAvatar } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import ReplyForm from '@/components/ReplyForm';
import RichText from '@/components/RichText';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Discussion' };

export default async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await safe(() => getTopic(decodeURIComponent(id)), null as any);
  if (!data) notFound();
  const { topic, replies } = data;
  const u = await getSession();

  return (
    <main className="container thread">
      <Link href="/discussions" className="back-link">← All discussions</Link>
      <div className="thread-head">
        <div className="topic-meta" style={{ marginBottom: 4 }}>
          {topic.pinned && <span className="pill pin">Pinned</span>}
          {topic.locked && <span className="pill cyan">Locked</span>}
          {topic.category && <Link href={'/discussions?c=' + topic.category_slug} className="pill">{topic.category}</Link>}
        </div>
        <h1 className="display">{topic.title}</h1>
        <div className="topic-meta"><span>Started by {topic.author || 'Community'}</span><span>{fmtDateTime(topic.created_at)}</span><span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span><span>{topic.views} views</span></div>
      </div>

      <article className="post op">
        <div className="post-user">
          <img className="avatar-img" src={topic.tournament_logo || (!topic.author ? '/brand/wtsl-logo-200.png' : discordAvatar(topic.avatar, topic.author || 'W'))} alt="" />
          <strong>{topic.author || 'Community'}</strong>
          <span className="pill role">Original poster</span>
        </div>
        <div className="post-content"><div className="post-date">{fmtDateTime(topic.created_at)}</div><RichText text={topic.body} /></div>
      </article>

      {replies.map((r: any) => (
        <article className="post" key={r.id}>
          <div className="post-user">
            <img className="avatar-img" src={discordAvatar(r.avatar, r.author || 'W')} alt="" />
            <strong>{r.author || 'Community'}</strong>
            {r.is_admin && <span className="pill cyan role">Admin</span>}
          </div>
          <div className="post-content"><div className="post-date">{fmtDateTime(r.created_at)}</div><RichText text={r.body} /></div>
        </article>
      ))}

      {u ? (
        topic.locked && !u.isAdmin ? <div className="notice">This discussion has been locked by a moderator.</div> : <ReplyForm topicId={Number(topic.id)} />
      ) : (
        <div className="compose">Sign in to join this conversation.<br /><a className="btn btn-discord" href="/api/auth/discord">Join with Discord</a></div>
      )}
    </main>
  );
}
