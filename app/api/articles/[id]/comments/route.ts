import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { moderateTextAndImages, ModerationUnavailableError } from '@/lib/moderation';
import { spoilerMarkupError } from '@/lib/spoilers';
import { notifyForumMentions } from '@/lib/forumNotifications';
import { notifyForumAdminsForReview } from '@/lib/discord';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteContext) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in with Discord first.' }, { status: 401 });

  const { id } = await params;
  const articleId = Number(id);
  if (!Number.isSafeInteger(articleId) || articleId < 1) {
    return NextResponse.json({ error: 'Invalid article id.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const parentCommentId = body?.parentCommentId == null ? null : Number(body.parentCommentId);
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ error: 'Comment text is required.' }, { status: 400 });
  if (parentCommentId !== null && (!Number.isSafeInteger(parentCommentId) || parentCommentId < 1)) {
    return NextResponse.json({ error: 'Choose a valid comment to reply to.' }, { status: 400 });
  }
  if (text.length > 10000) return NextResponse.json({ error: 'Comments must be 10,000 characters or fewer.' }, { status: 400 });
  const spoilerError = spoilerMarkupError(text);
  if (spoilerError) return NextResponse.json({ error: spoilerError }, { status: 400 });

  const article = await sql`SELECT id,slug FROM articles WHERE id=${articleId} AND published=TRUE LIMIT 1`;
  if (!article[0]) return NextResponse.json({ error: 'Article not found.' }, { status: 404 });
  if (parentCommentId !== null) {
    const parent = await sql`
      SELECT id FROM article_comments
      WHERE id=${parentCommentId} AND article_id=${articleId} AND moderation_status='approved'
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
    return NextResponse.json({ error: 'This comment appears to contain prohibited explicit sexual content or graphic gore.' }, { status: 422 });
  }

  const rows = await sql`
    INSERT INTO article_comments(article_id,parent_comment_id,author_id,body,moderation_status,moderation_reason)
    VALUES (${articleId},${parentCommentId},${Number(user.id)},${text},${decision.status},${decision.reason})
    RETURNING id
  `;
  if (decision.status === 'pending') {
    await notifyForumAdminsForReview('An article comment needs moderator review.', '/admin/moderation');
    return NextResponse.json(
      { id: rows[0].id, pending: true, message: 'Your comment is waiting for moderator review.' },
      { status: 202 },
    );
  }
  await notifyForumMentions({
    body: text,
    authorUserId: user.id,
    authorName: user.username,
    context: 'in an article comment',
    href: `/articles/${encodeURIComponent(String(article[0].slug))}`,
  });
  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}
