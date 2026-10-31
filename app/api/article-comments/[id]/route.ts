import { NextResponse } from 'next/server';
import { canModerateComments, getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { moderateTextAndImages, ModerationUnavailableError } from '@/lib/moderation';
import { spoilerMarkupError } from '@/lib/spoilers';
import { notifyForumMentions } from '@/lib/forumNotifications';

type RouteContext = { params: Promise<{ id: string }> };

async function commentIdFromParams(params: RouteContext['params']) {
  const { id } = await params;
  const commentId = Number(id);
  return Number.isSafeInteger(commentId) && commentId > 0 ? commentId : null;
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const commentId = await commentIdFromParams(params);
  if (!commentId) return NextResponse.json({ error: 'Invalid comment id.' }, { status: 400 });

  const body = await req.json().catch(() => null);
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ error: 'Comment text is required.' }, { status: 400 });
  if (text.length > 10000) return NextResponse.json({ error: 'Comments must be 10,000 characters or fewer.' }, { status: 400 });
  const spoilerError = spoilerMarkupError(text);
  if (spoilerError) return NextResponse.json({ error: spoilerError }, { status: 400 });

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

  const previous = await sql`
    SELECT c.body,c.moderation_status,a.slug
    FROM article_comments c
    JOIN articles a ON a.id=c.article_id
    WHERE c.id=${commentId} AND c.author_id=${Number(user.id)}
    LIMIT 1
  `;
  const updated = await sql`
    UPDATE article_comments
    SET body=${text},updated_at=NOW(),moderation_status=${decision.status},
        moderation_reason=${decision.reason},moderated_at=NULL,moderated_by=NULL
    WHERE id=${commentId} AND author_id=${Number(user.id)}
    RETURNING id
  `;
  if (!updated[0]) {
    const existing = await sql`SELECT id FROM article_comments WHERE id=${commentId} LIMIT 1`;
    if (!existing[0]) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 });
    return NextResponse.json({ error: 'You can only edit your own comments.' }, { status: 403 });
  }

  if (decision.status === 'approved' && previous[0]) {
    await notifyForumMentions({
      body: text,
      previousBody: previous[0].moderation_status === 'approved' ? previous[0].body : '',
      authorUserId: user.id,
      authorName: user.username,
      context: 'in an article comment',
      href: `/articles/${encodeURIComponent(String(previous[0].slug))}`,
    });
  }

  return decision.status === 'pending'
    ? NextResponse.json({ ok: true, pending: true, message: 'Your edited comment is waiting for moderator review.' }, { status: 202 })
    : NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const commentId = await commentIdFromParams(params);
  if (!commentId) return NextResponse.json({ error: 'Invalid comment id.' }, { status: 400 });

  const removed = await sql`
    DELETE FROM article_comments
    WHERE id=${commentId} AND (author_id=${Number(user.id)} OR ${canModerateComments(user)})
    RETURNING id
  `;
  if (!removed[0]) {
    const existing = await sql`SELECT id FROM article_comments WHERE id=${commentId} LIMIT 1`;
    if (!existing[0]) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 });
    return NextResponse.json({ error: 'Not permitted to delete this comment.' }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
