import { sql } from './db';
import { sendDM } from './discord';

const MAX_MENTION_NOTIFICATIONS_PER_POST = 8;

function forumSiteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.wtslforum.com').replace(/\/+$/, '');
}

function forumLink(path: string) {
  const safePath = path.startsWith('/') && !path.startsWith('//') ? path : '/';
  return `${forumSiteUrl()}${safePath}`;
}

function logNotificationFailure(kind: string, error: unknown) {
  console.warn(
    `[forum-notifications] ${kind} failed`,
    error instanceof Error ? error.name : 'UnknownError',
  );
}

export async function notifyForumDirectMessage(input: {
  recipientUserId: string | number;
  senderUserId: string | number;
  senderName: string;
}) {
  try {
    const rows = await sql`
      SELECT discord_id
      FROM users
      WHERE id=${Number(input.recipientUserId)}
      LIMIT 1
    `;
    const discordId = rows[0]?.discord_id;
    if (!discordId) return;

    const senderName = input.senderName.trim().slice(0, 80) || 'A Forum member';
    await sendDM(
      String(discordId),
      `📨 **WTSL Forum message**\n${senderName} sent you a direct message.\n${forumLink(`/messages/${encodeURIComponent(String(input.senderUserId))}`)}`,
    );
  } catch (error) {
    logNotificationFailure('direct-message notification', error);
  }
}

function mentionedUsernames(body: string) {
  const names = new Set<string>();
  for (const match of body.matchAll(/(?:^|\s)@([a-zA-Z0-9_]{1,32})(?![a-zA-Z0-9_])/g)) {
    names.add(match[1].toLowerCase());
    if (names.size >= MAX_MENTION_NOTIFICATIONS_PER_POST) break;
  }
  return [...names];
}

export async function notifyForumMentions(input: {
  body: string;
  previousBody?: string;
  authorUserId: string | number;
  authorName: string;
  context: string;
  href: string;
}) {
  const existing = new Set(mentionedUsernames(input.previousBody || ''));
  const names = mentionedUsernames(input.body).filter((name) => !existing.has(name));
  if (!names.length) return;

  try {
    const rows = await sql`
      SELECT id, discord_id
      FROM users
      WHERE lower(username) = ANY(${names})
        AND verified_player_id IS NOT NULL
        AND id <> ${Number(input.authorUserId)}
    `;
    const recipients = new Map<string, string>();
    for (const row of rows as Array<{ id: string | number; discord_id: string }>) {
      const discordId = String(row.discord_id || '');
      if (discordId) recipients.set(discordId, String(row.id));
    }

    const authorName = input.authorName.trim().slice(0, 80) || 'A Forum member';
    const context = input.context.trim().slice(0, 100) || 'Forum post';
    const link = forumLink(input.href);
    await Promise.all(
      [...recipients.keys()].map((discordId) =>
        sendDM(discordId, `🔔 **WTSL Forum mention**\n${authorName} mentioned you ${context}.\n${link}`),
      ),
    );
  } catch (error) {
    logNotificationFailure('mention notifications', error);
  }
}
