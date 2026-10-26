import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';

// A handful of fixed emoji so the UI can render a small, predictable reaction bar instead of a
// full emoji picker — matches the "like/upvote" style reactions requested, not freeform emoji.
const ALLOWED_EMOJI = new Set(['👍', '🔥', '😂', '🎾', '❤️']);

/** Toggles one (user, post, emoji) reaction and returns full counts with reactor identities. */
export async function POST(req: Request) {
  const u = await getSession();
  if (!u) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  const b = await req.json().catch(() => null);
  const emoji = String(b?.emoji ?? '');
  const rawTargets = [b?.topicId, b?.replyId, b?.articleId, b?.articleCommentId];
  const hasTarget = rawTargets.map((value) => value !== undefined && value !== null);
  const ids = rawTargets.map((value) => value === undefined || value === null ? null : Number(value));
  if (!ALLOWED_EMOJI.has(emoji) || hasTarget.filter(Boolean).length !== 1 ||
      ids.some((id, index) => hasTarget[index] && (!Number.isSafeInteger(id) || Number(id) < 1))) {
    return NextResponse.json({ error: 'Invalid reaction' }, { status: 400 });
  }
  const [topicId, replyId, articleId, articleCommentId] = ids as [number | null, number | null, number | null, number | null];

  const target = articleCommentId
    ? await sql`
        SELECT c.id FROM article_comments c
        JOIN articles a ON a.id=c.article_id
        WHERE c.id=${articleCommentId} AND c.moderation_status='approved' AND a.published=TRUE
        LIMIT 1
      `
    : articleId
    ? await sql`SELECT id FROM articles WHERE id=${articleId} AND published=TRUE LIMIT 1`
    : topicId
      ? await sql`SELECT id FROM topics WHERE id=${topicId} AND moderation_status='approved' LIMIT 1`
      : await sql`SELECT r.id FROM replies r JOIN topics t ON t.id=r.topic_id WHERE r.id=${replyId} AND r.moderation_status='approved' AND t.moderation_status='approved' LIMIT 1`;
  if (!target[0]) return NextResponse.json({ error: 'Article, discussion or comment not found.' }, { status: 404 });

  const existing = articleCommentId !== null
    ? await sql`
        SELECT id FROM article_comment_reactions
        WHERE user_id=${Number(u.id)} AND article_comment_id=${articleCommentId} AND emoji=${emoji}
      `
    : await sql`
        SELECT id FROM reactions
        WHERE user_id = ${Number(u.id)} AND emoji = ${emoji}
          AND topic_id IS NOT DISTINCT FROM ${topicId}
          AND reply_id IS NOT DISTINCT FROM ${replyId}
          AND article_id IS NOT DISTINCT FROM ${articleId}
      `;
  if (existing.length) {
    if (articleCommentId !== null) {
      await sql`DELETE FROM article_comment_reactions WHERE id=${existing[0].id}`;
    } else {
      await sql`DELETE FROM reactions WHERE id = ${existing[0].id}`;
    }
  } else if (articleCommentId !== null) {
    await sql`
      INSERT INTO article_comment_reactions(user_id,article_comment_id,emoji)
      VALUES (${Number(u.id)},${articleCommentId},${emoji}) ON CONFLICT DO NOTHING
    `;
  } else {
    await sql`INSERT INTO reactions(user_id,topic_id,reply_id,article_id,emoji)
      VALUES (${Number(u.id)},${topicId},${replyId},${articleId},${emoji}) ON CONFLICT DO NOTHING`;
  }

  const counts = articleCommentId !== null ? await sql`
    SELECT r.emoji,COUNT(*)::int count,
      COALESCE(BOOL_OR(r.user_id=${Number(u.id)}::bigint),false) reacted,
      COALESCE(ARRAY_AGG(
        COALESCE(reaction_identity.player_name,users.display_name)
        ORDER BY COALESCE(reaction_identity.player_name,users.display_name)
      ) FILTER (WHERE COALESCE(reaction_identity.player_name,users.display_name) IS NOT NULL),
        ARRAY[]::text[]) reactors
    FROM article_comment_reactions r
    LEFT JOIN users ON users.id=r.user_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(wp.name,''),NULLIF(pc.player_name,'')) player_name
      FROM player_claims pc
      LEFT JOIN wtsl_players wp ON wp.wtsl_player_id=pc.wtsl_player_id AND wp.tour=pc.tour
      WHERE pc.user_id=users.id AND pc.status='approved'
      ORDER BY CASE WHEN pc.id=users.default_player_claim_id THEN 0 ELSE 1 END,
        CASE WHEN pc.tour='TE4' THEN 0 ELSE 1 END,pc.created_at ASC,pc.id ASC
      LIMIT 1
    ) reaction_identity ON TRUE
    WHERE r.article_comment_id=${articleCommentId}
    GROUP BY r.emoji
  ` : await sql`
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
    WHERE r.topic_id IS NOT DISTINCT FROM ${topicId}
      AND r.reply_id IS NOT DISTINCT FROM ${replyId}
      AND r.article_id IS NOT DISTINCT FROM ${articleId}
    GROUP BY r.emoji
  `;
  return NextResponse.json({ ok: true, reacted: !existing.length, counts });
}
