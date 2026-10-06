import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getPrivateCommunityNoteProposals } from '@/lib/communityNotes';
import { moderateTextAndImages, ModerationUnavailableError } from '@/lib/moderation';
import { spoilerMarkupError } from '@/lib/spoilers';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in to review community notes.' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const targetType = params.get('targetType');
  const targetId = Number(params.get('targetId'));
  if ((targetType !== 'topic' && targetType !== 'reply') || !Number.isSafeInteger(targetId) || targetId < 1) {
    return NextResponse.json({ error: 'Choose a valid discussion or reply.' }, { status: 400 });
  }

  const target = targetType === 'topic'
    ? await sql`SELECT id FROM topics WHERE id=${targetId} AND moderation_status='approved' LIMIT 1`
    : await sql`SELECT id FROM replies WHERE id=${targetId} AND moderation_status='approved' LIMIT 1`;
  if (!target[0]) return NextResponse.json({ error: 'That discussion or reply is no longer available.' }, { status: 404 });

  const notes = await getPrivateCommunityNoteProposals(targetType, targetId, user.id);
  return NextResponse.json(
    { notes },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in to submit a community note.' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const targetType = body?.targetType;
  const targetId = Number(body?.targetId);
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!['topic', 'reply'].includes(targetType) || !Number.isSafeInteger(targetId) || targetId < 1 || !text) {
    return NextResponse.json({ error: 'Choose a discussion or reply and write a note.' }, { status: 400 });
  }
  if (text.length > 3000) return NextResponse.json({ error: 'Community notes must be 3,000 characters or fewer.' }, { status: 400 });
  const spoilerError = spoilerMarkupError(text);
  if (spoilerError) return NextResponse.json({ error: spoilerError }, { status: 400 });

  const target = targetType === 'topic'
    ? await sql`SELECT id FROM topics WHERE id=${targetId} AND moderation_status='approved' LIMIT 1`
    : await sql`SELECT id FROM replies WHERE id=${targetId} AND moderation_status='approved' LIMIT 1`;
  if (!target[0]) return NextResponse.json({ error: 'That discussion or reply is no longer available.' }, { status: 404 });

  let decision;
  try {
    decision = await moderateTextAndImages(text);
  } catch (error) {
    if (error instanceof ModerationUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
  if (decision.status === 'rejected') {
    return NextResponse.json({ error: 'This note appears to contain prohibited explicit sexual content or graphic gore.' }, { status: 422 });
  }

  const rows = targetType === 'topic'
    ? await sql`
        INSERT INTO community_notes(topic_id,author_id,body,moderation_status,moderation_reason)
        VALUES (${targetId},${Number(user.id)},${text},${decision.status},${decision.reason})
        ON CONFLICT DO NOTHING RETURNING id
      `
    : await sql`
        INSERT INTO community_notes(reply_id,author_id,body,moderation_status,moderation_reason)
        VALUES (${targetId},${Number(user.id)},${text},${decision.status},${decision.reason})
        ON CONFLICT DO NOTHING RETURNING id
      `;
  if (!rows[0]) return NextResponse.json({ error: 'You have already submitted a note for this item.' }, { status: 409 });
  return NextResponse.json({
    ok: true,
    pending: decision.status === 'pending',
    message: decision.status === 'pending' ? 'Your note is waiting for moderator review.' : 'Your note was sent privately for community review.',
  }, { status: 201 });
}