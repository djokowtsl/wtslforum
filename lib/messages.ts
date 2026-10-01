import { sql } from './db';

function conversationKey(a: string | number, b: string | number) {
  const [x, y] = [Number(a), Number(b)].sort((m, n) => m - n);
  return `${x}:${y}`;
}

export type DirectMessage = {
  id: number;
  conversation_key: string;
  sender_id: number;
  recipient_id: number;
  body: string;
  read_at: string | null;
  created_at: string;
  sender_name?: string;
  sender_avatar?: string | null;
};

/** A lightweight member-to-member inbox — polling-based refresh, not real-time chat infra. */
export async function sendMessage(senderId: string | number, recipientId: string | number, body: string) {
  if (Number(senderId) === Number(recipientId)) throw new Error("You can't message yourself");
  const key = conversationKey(senderId, recipientId);
  const rows = await sql`
    INSERT INTO direct_messages (conversation_key, sender_id, recipient_id, body)
    VALUES (${key}, ${Number(senderId)}, ${Number(recipientId)}, ${body})
    RETURNING *`;
  return rows[0] as DirectMessage;
}

export async function getThread(userId: string | number, otherUserId: string | number, limit = 200) {
  const key = conversationKey(userId, otherUserId);
  const rows = await sql`
    SELECT dm.*, us.display_name sender_name, us.avatar_url sender_avatar
    FROM direct_messages dm
    LEFT JOIN users us ON us.id = dm.sender_id
    WHERE dm.conversation_key = ${key}
    ORDER BY dm.created_at ASC
    LIMIT ${limit}`;
  return rows as DirectMessage[];
}

export async function markThreadRead(userId: string | number, otherUserId: string | number) {
  const key = conversationKey(userId, otherUserId);
  await sql`UPDATE direct_messages SET read_at = NOW() WHERE conversation_key = ${key} AND recipient_id = ${Number(userId)} AND read_at IS NULL`;
}

export type Conversation = {
  conversation_key: string;
  other_id: number;
  other_name: string;
  other_avatar: string | null;
  other_status: string | null;
  last_body: string;
  last_at: string;
  last_sender_id: number;
  unread: number;
};

export async function listConversations(userId: string | number): Promise<Conversation[]> {
  const rows = await sql`
    SELECT * FROM (
      SELECT DISTINCT ON (dm.conversation_key)
        dm.conversation_key, dm.body last_body, dm.created_at last_at, dm.sender_id last_sender_id,
        other.id other_id, other.display_name other_name, other.avatar_url other_avatar, other.status other_status,
        (SELECT COUNT(*)::int FROM direct_messages u2 WHERE u2.conversation_key = dm.conversation_key AND u2.recipient_id = ${Number(userId)} AND u2.read_at IS NULL) unread
      FROM direct_messages dm
      JOIN users other ON other.id = (CASE WHEN dm.sender_id = ${Number(userId)} THEN dm.recipient_id ELSE dm.sender_id END)
      WHERE dm.sender_id = ${Number(userId)} OR dm.recipient_id = ${Number(userId)}
      ORDER BY dm.conversation_key, dm.created_at DESC
    ) x
    ORDER BY x.last_at DESC`;
  return rows as Conversation[];
}

export async function unreadMessageCount(userId: string | number): Promise<number> {
  const rows = await sql`SELECT COUNT(*)::int c FROM direct_messages WHERE recipient_id = ${Number(userId)} AND read_at IS NULL`;
  return rows[0]?.c ?? 0;
}
