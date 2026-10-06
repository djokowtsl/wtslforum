import { NextResponse } from 'next/server';
import { canModerateComments, getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { spoilerMarkupError } from '@/lib/spoilers';

const plainText = (value: string) => value.replace(/\|\|/g, '');

export async function PATCH(req: Request) {
  const user = await getSession();
  if (!canModerateComments(user)) return NextResponse.json({ error: 'Moderator access required.' }, { status: 403 });
  const body = await req.json().catch(() => null);
  const kind = body?.kind;
  const id = Number(body?.id);
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!['topic', 'reply'].includes(kind) || !Number.isSafeInteger(id) || id < 1 || !text) {
    return NextResponse.json({ error: 'Choose a discussion or reply and provide the corrected text.' }, { status: 400 });
  }
  const spoilerError = spoilerMarkupError(text);
  if (text.length > 20000 || spoilerError) {
    return NextResponse.json({ error: spoilerError || 'Text must be 20,000 characters or fewer.' }, { status: 400 });
  }

  if (kind === 'topic') {
    const current = await sql`SELECT body FROM topics WHERE id=${id} AND moderation_status='approved' LIMIT 1`;
    if (!current[0]) return NextResponse.json({ error: 'Discussion not found.' }, { status: 404 });
    if (plainText(current[0].body) !== plainText(text)) {
      return NextResponse.json({ error: 'Moderators may correct spoiler markers, but not rewrite the post text here.' }, { status: 400 });
    }
    await sql`UPDATE topics SET body=${text},updated_at=NOW() WHERE id=${id}`;
  } else {
    const current = await sql`SELECT body,topic_id FROM replies WHERE id=${id} AND moderation_status='approved' LIMIT 1`;
    if (!current[0]) return NextResponse.json({ error: 'Reply not found.' }, { status: 404 });
    if (plainText(current[0].body) !== plainText(text)) {
      return NextResponse.json({ error: 'Moderators may correct spoiler markers, but not rewrite the reply text here.' }, { status: 400 });
    }
    await sql`UPDATE replies SET body=${text},updated_at=NOW() WHERE id=${id}`;
    await sql`UPDATE topics SET updated_at=NOW() WHERE id=${current[0].topic_id}`;
  }
  return NextResponse.json({ ok: true });
}