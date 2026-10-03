import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { announceTopic } from '@/lib/discord';
import { claimMatchThread } from '@/lib/matchThreads';
import { moderateTextAndImages, ModerationUnavailableError } from '@/lib/moderation';
import { spoilerMarkupError } from '@/lib/spoilers';
import { isTourCode } from '@/lib/wtsl';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);

export async function POST(req: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in with Discord first.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 140) : '';
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  const categoryId = Number(body?.categoryId);
  if (!title || !text || !Number.isSafeInteger(categoryId) || categoryId < 1) {
    return NextResponse.json({ error: 'Title, category and post are required.' }, { status: 400 });
  }
  if (text.length > 20000) return NextResponse.json({ error: 'Posts must be 20,000 characters or fewer.' }, { status: 400 });
  const spoilerError = spoilerMarkupError(text);
  if (spoilerError) return NextResponse.json({ error: spoilerError }, { status: 400 });

  let decision;
  try {
    decision = await moderateTextAndImages(`${title}\n${text}`);
  } catch (error) {
    if (error instanceof ModerationUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    throw error;
  }
  if (decision.status === 'rejected') {
    return NextResponse.json({ error: 'This post appears to contain prohibited explicit sexual content or graphic gore.' }, { status: 422 });
  }

  const base = slugify(title);
  const rows = await sql`
    INSERT INTO topics(category_id,author_id,title,slug,body,moderation_status,moderation_reason)
    VALUES (${categoryId},${Number(user.id)},${title},${base+'-'+Date.now()},${text},${decision.status},${decision.reason})
    RETURNING id
  `;
  let id = Number(rows[0].id);
  let won = true;
  if (body.matchKey) {
    const winnerId = await claimMatchThread(String(body.matchKey), id, isTourCode(body.tour) ? body.tour : null);
    if (winnerId !== id) {
      await sql`DELETE FROM topics WHERE id=${id}`;
      id = winnerId;
      won = false;
    }
  }
  if (won && decision.status === 'approved') await announceTopic(title, id, user.username).catch(() => {});
  if (decision.status === 'pending' && won) {
    return NextResponse.json({ id, pending: true, message: 'Your discussion is waiting for moderator review.' }, { status: 202 });
  }
  return NextResponse.json({ id }, { status: 201 });
}