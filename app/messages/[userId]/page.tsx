import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { sql, safe } from '@/lib/db';
import { getSession, discordAvatar } from '@/lib/auth';
import { getThread, markThreadRead } from '@/lib/messages';
import PageHero from '@/components/PageHero';
import MessageThread from '@/components/MessageThread';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Conversation' };

export default async function ThreadPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const u = await getSession();
  if (!u) redirect('/api/auth/discord');
  if (!/^\d+$/.test(userId) || Number(userId) === Number(u.id)) notFound();

  const otherRows = await safe(() => sql`SELECT id, display_name, avatar_url, status FROM users WHERE id=${Number(userId)} LIMIT 1`, [] as any[]);
  const other = otherRows[0];
  if (!other) notFound();

  const messages = await safe(() => getThread(u.id, userId), []);
  await safe(() => markThreadRead(u.id, userId), undefined);

  return (
    <>
      <PageHero eyebrow="Conversation" title={other.display_name}>Direct message thread.</PageHero>
      <main className="container narrow">
        <MessageThread
          currentUserId={u.id}
          otherUserId={String(other.id)}
          otherName={other.display_name}
          otherAvatar={discordAvatar(other.avatar_url, other.display_name)}
          initialMessages={messages}
        />
      </main>
    </>
  );
}
