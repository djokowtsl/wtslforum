import { redirect } from 'next/navigation';
import AdminModerationQueue, { type ModerationQueueItem } from '@/components/AdminModerationQueue';
import PageHero from '@/components/PageHero';
import { canModerateComments, getSession } from '@/lib/auth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function AdminModeration() {
  const user = await getSession();
  if (!user) redirect('/api/auth/discord');
  if (!canModerateComments(user)) redirect('/');

  const [topics, replies, media, notes] = await Promise.all([
    sql`SELECT t.id,t.title,t.body,t.moderation_reason,t.created_at,u.display_name author FROM topics t LEFT JOIN users u ON u.id=t.author_id WHERE t.moderation_status='pending'`,
    sql`SELECT r.id,r.body,r.moderation_reason,r.created_at,u.display_name author,t.title FROM replies r JOIN topics t ON t.id=r.topic_id LEFT JOIN users u ON u.id=r.author_id WHERE r.moderation_status='pending'`,
    sql`SELECT c.id,c.title,c.description,c.url,c.moderation_reason,c.created_at,c.private_blob_pathname,c.private_blob_content_type,u.display_name author FROM media_clips c LEFT JOIN users u ON u.id=c.submitted_by WHERE c.moderation_status='pending'`,
    sql`SELECT n.id,n.body,n.moderation_reason,n.created_at,COALESCE(t.title,reply_topic.title) AS context FROM community_notes n LEFT JOIN topics t ON t.id=n.topic_id LEFT JOIN replies r ON r.id=n.reply_id LEFT JOIN topics reply_topic ON reply_topic.id=r.topic_id WHERE n.moderation_status='pending'`,
  ]);

  const items: ModerationQueueItem[] = [
    ...topics.map((row) => ({ id: Number(row.id), kind: 'topic' as const, title: row.title, body: row.body, author: row.author, createdAt: new Date(row.created_at).toISOString(), reason: row.moderation_reason })),
    ...replies.map((row) => ({ id: Number(row.id), kind: 'reply' as const, title: `Reply on: ${row.title}`, body: row.body, author: row.author, createdAt: new Date(row.created_at).toISOString(), reason: row.moderation_reason })),
    ...media.map((row) => ({ id: Number(row.id), kind: 'media' as const, title: row.title, body: row.description, author: row.author, createdAt: new Date(row.created_at).toISOString(), reason: row.moderation_reason, externalUrl: row.url || null, privateFile: Boolean(row.private_blob_pathname), privateContentType: row.private_blob_content_type })),
    ...notes.map((row) => ({ id: Number(row.id), kind: 'note' as const, title: `Community note on: ${row.context || 'discussion'}`, body: row.body, author: 'Anonymous', createdAt: new Date(row.created_at).toISOString(), reason: row.moderation_reason })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <>
      <PageHero eyebrow="Staff" title="Moderation queue">Review uncertain posts, replies, media and community notes before they appear publicly.</PageHero>
      <main className="container">
        <AdminModerationQueue items={items} />
      </main>
    </>
  );
}