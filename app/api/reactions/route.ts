import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';

// A handful of fixed emoji so the UI can render a small, predictable reaction bar instead of a
// full emoji picker — matches the "like/upvote" style reactions requested, not freeform emoji.
const ALLOWED_EMOJI = new Set(['👍', '🔥', '😂', '🎾', '❤️']);

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
  if (!ALLOWED_EMOJI.has(emoji) || Boolean(topicId) === Boolean(replyId) ||
      (topicId !== null && (!Number.isSafeInteger(topicId) || topicId < 1)) ||
      (replyId !== null && (!Number.isSafeInteger(replyId) || replyId < 1))) {
    return NextResponse.json({ error: 'Invalid reaction' }, { status: 400 });
  }

  const target = topicId
    ? await sql`SELECT id FROM topics WHERE id=${topicId} AND moderation_status='approved' LIMIT 1`
    : await sql`SELECT r.id FROM replies r JOIN topics t ON t.id=r.topic_id WHERE r.id=${replyId} AND r.moderation_status='approved' AND t.moderation_status='approved' LIMIT 1`;
  if (!target[0]) return NextResponse.json({ error: 'Discussion or reply not found.' }, { status: 404 });

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
    SELECT r.emoji, COUNT(*)::int count,
      COALESCE(BOOL_OR(r.user_id=${Number(u.id)}::bigint), false) reacted,
      COALESCE(ARRAY_AGG(
        COALESCE(reaction_identity.player_name, users.display_name)
        ORDER BY COALESCE(reaction_identity.player_name, users.display_name)
      ) FILTER (WHERE COALESCE(reaction_identity.player_name, users.display_name) IS NOT NULL),
        ARRAY[]::text[]) reactors
    FROM reactions r
    LEFT JOIN users ON users.id=r.user_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(wp.name, ''), NULLIF(pc.player_name, '')) AS player_name
      FROM player_claims pc
      LEFT JOIN wtsl_players wp
        ON wp.wtsl_player_id = pc.wtsl_player_id AND wp.tour = pc.tour
      WHERE pc.user_id = users.id AND pc.status = 'approved'
      ORDER BY CASE WHEN pc.id = users.default_player_claim_id THEN 0 ELSE 1 END,
        CASE WHEN pc.tour = 'TE4' THEN 0 ELSE 1 END, pc.created_at ASC, pc.id ASC
      LIMIT 1
    ) reaction_identity ON TRUE
    WHERE r.topic_id IS NOT DISTINCT FROM ${topicId} AND r.reply_id IS NOT DISTINCT FROM ${replyId}
    GROUP BY r.emoji
  `;
  return NextResponse.json({ ok: true, reacted: !existing.length, counts });
}
