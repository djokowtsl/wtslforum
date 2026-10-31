import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { moderateTextAndImages, ModerationUnavailableError } from '@/lib/moderation';
import { spoilerMarkupError } from '@/lib/spoilers';
import { notifyForumMentions } from '@/lib/forumNotifications';
import { notifyForumAdminsForReview } from '@/lib/discord';

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in with Discord first.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const topicId = Number(body?.topicId);
  const parentReplyId = body?.parentReplyId == null ? null : Number(body.parentReplyId);
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!Number.isSafeInteger(topicId) || topicId < 1 || !text) {
    return NextResponse.json({ error: 'Reply text is required.' }, { status: 400 });
  }
  if (parentReplyId !== null && (!Number.isSafeInteger(parentReplyId) || parentReplyId < 1)) {
    return NextResponse.json({ error: 'Choose a valid comment to reply to.' }, { status: 400 });
  }
  if (text.length > 10000) return NextResponse.json({ error: 'Replies must be 10,000 characters or fewer.' }, { status: 400 });
  const spoilerError = spoilerMarkupError(text);
  if (spoilerError) return NextResponse.json({ error: spoilerError }, { status: 400 });

  const topic = await sql`SELECT locked FROM topics WHERE id=${topicId} AND moderation_status='approved' LIMIT 1`;
  if (!topic[0]) return NextResponse.json({ error: 'Discussion not found.' }, { status: 404 });
  if (topic[0].locked && !user.isAdmin) return NextResponse.json({ error: 'This discussion is locked.' }, { status: 403 });
  if (parentReplyId !== null) {
    const parent = await sql`
      SELECT id FROM replies
      WHERE id=${parentReplyId} AND topic_id=${topicId} AND moderation_status='approved'
      LIMIT 1
    `;
    if (!parent[0]) return NextResponse.json({ error: 'That comment is no longer available.' }, { status: 404 });
  }

  let decision;
  try {
    decision = await moderateTextAndImages(text);
  } catch (error) {
    if (error instanceof ModerationUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
  if (decision.status === 'rejected') {
    return NextResponse.json({ error: 'This reply appears to contain prohibited explicit sexual content or graphic gore.' }, { status: 422 });
  }

  const rows = await sql`
    INSERT INTO replies(topic_id,parent_reply_id,author_id,body,moderation_status,moderation_reason)
    VALUES (${topicId},${parentReplyId},${Number(user.id)},${text},${decision.status},${decision.reason})
    RETURNING id
  `;
  if (decision.status === 'approved') {
    await sql`UPDATE topics SET updated_at=NOW() WHERE id=${topicId}`;
    await notifyForumMentions({
      body: text,
      authorUserId: user.id,
      authorName: user.username,
      context: 'in a discussion reply',
      href: `/discussions/${topicId}`,
    });
  }
  if (decision.status === 'pending') {
    await notifyForumAdminsForReview('A discussion reply needs moderator review.', '/admin/moderation');
    return NextResponse.json({ id: rows[0].id, pending: true, message: 'Your reply is waiting for moderator review.' }, { status: 202 });
  }
  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}