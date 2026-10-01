import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';

// A handful of fixed emoji so the UI can render a small, predictable reaction bar instead of a
// full emoji picker — matches the "like/upvote" style reactions requested, not freeform emoji.
const ALLOWED_EMOJI = new Set(['👍', '🔥', '😂', '🎾']);

/** Toggles one (user, post, emoji) reaction: if it already exists this removes it, otherwise it's
 * added — the `reactions` table's UNIQUE(user_id,topic_id,reply_id,emoji) constraint is what makes
 * a single click here unambiguous either way. Returns the post's full updated emoji counts so the
 * client can re-render without a second fetch. */
export async function POST(req: Request) {
  const u = await getSession();
  if (!u) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const b = await req.json().catch(() => null);
  const emoji = String(b?.emoji ?? '');
  const topicId = b?.topicId ? Number(b.topicId) : null;
  const replyId = b?.replyId ? Number(b.replyId) : null;
  if (!ALLOWED_EMOJI.has(emoji) || (!topicId && !replyId)) {
    return NextResponse.json({ error: 'Invalid reaction' }, { status: 400 });
  }

  const existing = await sql`
    SELECT id FROM reactions
    WHERE user_id = ${Number(u.id)} AND emoji = ${emoji}
      AND topic_id IS NOT DISTINCT FROM ${topicId} AND reply_id IS NOT DISTINCT FROM ${replyId}
  `;
  if (existing.length) {
    await sql`DELETE FROM reactions WHERE id = ${existing[0].id}`;
  } else {
    await sql`INSERT INTO reactions(user_id,topic_id,reply_id,emoji) VALUES (${Number(u.id)},${topicId},${replyId},${emoji}) ON CONFLICT DO NOTHING`;
  }

  const counts = await sql`
    SELECT emoji, COUNT(*)::int count
    FROM reactions
    WHERE topic_id IS NOT DISTINCT FROM ${topicId} AND reply_id IS NOT DISTINCT FROM ${replyId}
    GROUP BY emoji
  `;
  return NextResponse.json({ ok: true, reacted: !existing.length, counts });
}
