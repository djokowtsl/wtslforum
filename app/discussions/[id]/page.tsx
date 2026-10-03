import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { getTopic, getThreadReactions } from '@/lib/queries';
import { resolveMentions } from '@/lib/messages';
import { getSession, discordAvatar } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import ReplyForm from '@/components/ReplyForm';
import RichText from '@/components/RichText';
import ReactionBar from '@/components/ReactionBar';
import { StatusDot } from '@/components/StatusDot';
import AdminTopicControls from '@/components/AdminTopicControls';
import ForumAvatar from '@/components/ForumAvatar';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Discussion' };

function officialAuthorHref(identity: { official_player_id?: string | null; official_tour?: string | null }) {
  if (!identity.official_player_id || !identity.official_tour) return null;
  return `/players/${encodeURIComponent(String(identity.official_player_id))}?tour=${encodeURIComponent(String(identity.official_tour))}`;
}

export default async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await safe(() => getTopic(decodeURIComponent(id)), null as any);
  if (!data) notFound();
  const { topic, replies } = data;
  const topicAuthorHref = officialAuthorHref(topic);
  const u = await getSession();
  const replyIds = replies.map((r: any) => Number(r.id));
  const reactions = await safe(() => getThreadReactions(Number(topic.id), replyIds, u?.id ?? null), { topic: [], replies: {} as Record<number, any> });
  const allUsernames = [topic.body, ...replies.map((r: any) => r.body)].flatMap((b: string) => [...(b || '').matchAll(/@(\w+)/g)].map((m) => m[1]));
  const mentionables = await safe(() => resolveMentions(allUsernames), {});

  return (
    <main className="container thread">
      <Link href="/discussions" className="back-link">← All discussions</Link>
      <div className="thread-head">
        <div className="topic-meta" style={{ marginBottom: 4 }}>
          {topic.pinned && <span className="pill pin">Pinned</span>}
          {topic.locked && <span className="pill cyan">Locked</span>}
          {topic.category && <Link href={'/discussions?c=' + topic.category_slug} className="pill">{topic.category}</Link>}
        </div>
        <div className="thread-title-row">
          <h1 className="display">{topic.title}</h1>
        </div>
        <div className="topic-meta"><span>Started by {topicAuthorHref ? <Link className="post-author-link" href={topicAuthorHref}>{topic.author}</Link> : topic.author || 'Community'}</span><span>{fmtDateTime(topic.created_at)}</span><span>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</span><span>{topic.views} views</span></div>
        {u?.isAdmin && <AdminTopicControls topicId={Number(topic.id)} locked={!!topic.locked} pinned={!!topic.pinned} />}
      </div>

      <article className="post op">
        <div className="post-user">
          <ForumAvatar
            size="post"
            src={topic.tournament_logo || (!topic.author ? '/brand/wtsl-logo-200.png' : discordAvatar(topic.avatar, topic.author || 'W'))}
            hasTournamentLogo={!!topic.tournament_logo}
            isCommunity={!topic.author}
          />
          <strong>{topic.author && <StatusDot status={topic.author_status} />} {topicAuthorHref ? <Link className="post-author-link" href={topicAuthorHref}>{topic.author}</Link> : topic.author || 'Community'}</strong>
          <span className="pill role">Original poster</span>
          {u && topic.author_id && Number(topic.author_id) !== Number(u.id) && (
            <Link href={`/messages/${topic.author_id}`} className="pill">Message</Link>
          )}
        </div>
        <div className="post-content"><div className="post-date">{fmtDateTime(topic.created_at)}</div><RichText text={topic.body} mentionables={mentionables} /><ReactionBar topicId={Number(topic.id)} initial={reactions.topic} signedIn={!!u} /></div>
      </article>

      {replies.map((r: any) => {
        const replyAuthorHref = officialAuthorHref(r);
        return (
          <article className='post' key={r.id}>
            <div className='post-user'>
              <img className='avatar-img' src={discordAvatar(r.avatar, r.author || 'W')} alt='' />
              <strong><StatusDot status={r.author_status} /> {replyAuthorHref ? <Link className='post-author-link' href={replyAuthorHref}>{r.author}</Link> : r.author || 'Community'}</strong>
              {r.is_admin && <span className='pill cyan role'>Admin</span>}
              {u && r.author_id && Number(r.author_id) !== Number(u.id) && (
                <Link href={`/messages/${r.author_id}`} className='pill'>Message</Link>
              )}
            </div>
            <div className='post-content'><div className='post-date'>{fmtDateTime(r.created_at)}</div><RichText text={r.body} mentionables={mentionables} /><ReactionBar replyId={Number(r.id)} initial={reactions.replies[Number(r.id)] || []} signedIn={!!u} /></div>
          </article>
        );
      })}

      {u ? (
        topic.locked && !u.isAdmin ? <div className="notice">This discussion has been locked by a moderator.</div> : <ReplyForm topicId={Number(topic.id)} />
      ) : (
        <div className="compose">Sign in to join this conversation.<br /><a className="btn btn-discord" href="/api/auth/discord">Log in with Discord</a></div>
      )}
    </main>
  );
}
