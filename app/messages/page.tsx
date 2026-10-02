import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { safe } from '@/lib/db';
import { getSession, discordAvatar } from '@/lib/auth';
import { listConversations, listOnlineMembers } from '@/lib/messages';
import { timeAgo } from '@/lib/format';
import PageHero from '@/components/PageHero';
import { StatusDot } from '@/components/StatusDot';
import { NewMessageBox } from '@/components/NewMessageBox';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Chat' };

export default async function MessagesPage() {
  const u = await getSession();
  if (!u) redirect('/api/auth/discord');
  const [conversations, online] = await Promise.all([
    safe(() => listConversations(u.id), []),
    safe(() => listOnlineMembers(u.id), []),
  ]);

  return (
    <>
      <PageHero eyebrow="Your inbox" title="Chat">Direct chats between forum members.</PageHero>
      <main className="container narrow">
        <NewMessageBox />

        {online.length > 0 && (
          <div className="online-panel">
            <span className="online-panel-label">Online now</span>
            <div className="online-panel-list">
              {online.map((m) => (
                <Link key={m.id} href={`/messages/${m.id}`} className="online-chip">
                  <img className="avatar-img" src={discordAvatar(m.avatar_url, m.display_name)} alt="" />
                  <StatusDot status={m.status} />
                  {m.display_name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {conversations.length === 0 ? (
          <div className="forum-list"><div className="empty"><strong>No chats yet</strong>Search for a member above, or start a conversation from someone's post or player profile.</div></div>
        ) : (
          <div className="forum-list">
            {conversations.map((c) => (
              <Link key={c.conversation_key} href={`/messages/${c.other_id}`} className="conversation-row">
                <img className="avatar-img" src={discordAvatar(c.other_avatar, c.other_name)} alt="" />
                <div className="conversation-main">
                  <div className="conversation-top">
                    <strong><StatusDot status={c.other_status} /> {c.other_name}</strong>
                    <span>{timeAgo(c.last_at)}</span>
                  </div>
                  <p>{c.last_sender_id === Number(u.id) ? 'You: ' : ''}{c.last_body}</p>
                </div>
                {c.unread > 0 && <span className="pill red">{c.unread}</span>}
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
