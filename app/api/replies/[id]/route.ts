import { NextResponse } from 'next/server';
import { canModerateComments, getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { moderateTextAndImages, ModerationUnavailableError } from '@/lib/moderation';
import { spoilerMarkupError } from '@/lib/spoilers';

type RouteContext = { params: Promise<{ id: string }> };

async function replyIdFromParams(params: RouteContext['params']) {
  const { id } = await params;
  const replyId = Number(id);
  return Number.isSafeInteger(replyId) && replyId > 0 ? replyId : null;
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const replyId = await replyIdFromParams(params);
  if (!replyId) return NextResponse.json({ error: 'Invalid comment id' }, { status: 400 });

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
    return NextResponse.json({ error: 'This reply appears to contain prohibited explicit sexual content or graphic gore.' }, { status: 422 });
  }

  const updated = await sql`
    UPDATE replies
    SET body=${text}, updated_at=NOW(), moderation_status=${decision.status}, moderation_reason=${decision.reason}, moderated_at=NULL, moderated_by=NULL
    WHERE id=${replyId} AND author_id=${Number(user.id)}
    RETURNING topic_id
  `;
  if (!updated[0]) {
    const existing = await sql`SELECT id FROM replies WHERE id=${replyId} LIMIT 1`;
    if (!existing[0]) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 });
    return NextResponse.json({ error: 'You can only edit your own comments.' }, { status: 403 });
  }

  if (decision.status === 'approved') await sql`UPDATE topics SET updated_at=NOW() WHERE id=${updated[0].topic_id}`;
  return NextResponse.json(
    decision.status === 'pending'
      ? { ok: true, pending: true, message: 'Your edited reply is waiting for moderator review.' }
      : { ok: true },
    { status: decision.status === 'pending' ? 202 : 200 },
  );
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const replyId = await replyIdFromParams(params);
  if (!replyId) return NextResponse.json({ error: 'Invalid comment id' }, { status: 400 });

  const removed = await sql`
    DELETE FROM replies
    WHERE id=${replyId} AND (author_id=${Number(user.id)} OR ${canModerateComments(user)})
    RETURNING topic_id
  `;
  if (!removed[0]) {
    const existing = await sql`SELECT id FROM replies WHERE id=${replyId} LIMIT 1`;
    if (!existing[0]) return NextResponse.json({ error: 'Comment not found.' }, { status: 404 });
    return NextResponse.json({ error: 'Not permitted to delete this comment.' }, { status: 403 });
  }

  await sql`UPDATE topics SET updated_at=NOW() WHERE id=${removed[0].topic_id}`;
  return NextResponse.json({ ok: true });
}
