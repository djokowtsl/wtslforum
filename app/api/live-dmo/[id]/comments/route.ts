import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { sql } from '@/lib/db';
import { moderateTextAndImages, ModerationUnavailableError, type ModerationOutcome } from '@/lib/moderation';
import { spoilerMarkupError } from '@/lib/spoilers';
import { isSameSiteMutation } from '@/lib/liveRequestSecurity';
import { notifyForumAdminsForReview } from '@/lib/discord';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;
const CHAT_MESSAGE_RATE_LIMIT = 8;
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
};
const messageSchema = z.object({ body: z.string().trim().min(1).max(500) }).strict();
type RouteContext = { params: Promise<{ id: string }> };

async function broadcastIdFromParams(params: RouteContext['params']) {
  const { id } = await params;
  return z.string().uuid().safeParse(id).success ? id : null;
}

async function broadcastExists(id: string) {
  const rows = await sql`
    SELECT id FROM dmo_live_broadcasts
    WHERE id=${id}::uuid AND expires_at > NOW()
    LIMIT 1
  `;
  return Boolean(rows[0]);
}

async function readMessage(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return { error: 'too_large' as const };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return { error: 'too_large' as const };
  try {
    const parsed = messageSchema.safeParse(JSON.parse(text));
    return parsed.success ? { data: parsed.data } : { error: 'invalid' as const };
  } catch {
    return { error: 'invalid' as const };
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to read live chat.' }, { status: 401, headers: PRIVATE_HEADERS });
  }
  const id = await broadcastIdFromParams(context.params);
  if (!id) return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });

  try {
    if (!await broadcastExists(id)) {
      return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    const rows = await sql`
      SELECT c.id, c.body, c.created_at, COALESCE(u.display_name, 'Forum member') AS author_name,
        CASE
          WHEN u.avatar_url LIKE 'https://cdn.discordapp.com/avatars/%' THEN u.avatar_url
          ELSE NULL
        END AS author_avatar
      FROM dmo_live_broadcast_comments c
      LEFT JOIN users u ON u.id=c.author_id
      WHERE c.broadcast_id=${id}::uuid AND c.moderation_status='approved'
      ORDER BY c.created_at DESC
      LIMIT 100
    `;
    const messages = rows.reverse().map((row: any) => ({
      id: String(row.id),
      body: row.body,
      authorName: row.author_name || 'Forum member',
      authorAvatar: row.author_avatar || null,
      createdAt: new Date(row.created_at).toISOString(),
    }));
    return NextResponse.json({ messages }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[live-broadcast-chat] read failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Live chat is temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!isSameSiteMutation(request)) {
    return NextResponse.json({ error: 'Request origin could not be verified.' }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to send a live chat message.' }, { status: 401, headers: PRIVATE_HEADERS });
  }
  const id = await broadcastIdFromParams(context.params);
  if (!id) return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });

  const parsed = await readMessage(request);
  if ('error' in parsed) {
    const tooLarge = parsed.error === 'too_large';
    return NextResponse.json(
      { error: tooLarge ? 'Message request is too large.' : 'Enter a message of 1 to 500 characters.' },
      { status: tooLarge ? 413 : 400, headers: PRIVATE_HEADERS },
    );
  }
  const text = parsed.data.body;
  const spoilerError = spoilerMarkupError(text);
  if (spoilerError) return NextResponse.json({ error: spoilerError }, { status: 400, headers: PRIVATE_HEADERS });

  try {
    if (!await broadcastExists(id)) {
      return NextResponse.json({ error: 'Broadcast not found.' }, { status: 404, headers: PRIVATE_HEADERS });
    }
    const recent = await sql`
      SELECT COUNT(*)::int AS count
      FROM dmo_live_broadcast_comments
      WHERE author_id=${Number(user.id)}
        AND created_at > NOW() - INTERVAL '1 minute'
    `;
    if (Number(recent[0]?.count || 0) >= CHAT_MESSAGE_RATE_LIMIT) {
      return NextResponse.json(
        { error: 'You are sending messages too quickly. Wait a minute and try again.' },
        { status: 429, headers: PRIVATE_HEADERS },
      );
    }

  let decision: ModerationOutcome;
    try {
      decision = await moderateTextAndImages(text);
    } catch (error) {
      if (error instanceof ModerationUnavailableError) {
        return NextResponse.json({ error: error.message }, { status: 503, headers: PRIVATE_HEADERS });
      }
      throw error;
    }
    if (decision.status === 'rejected') {
      return NextResponse.json(
        { error: 'This message appears to contain prohibited explicit sexual content or graphic gore.' },
        { status: 422, headers: PRIVATE_HEADERS },
      );
    }

    const rows = await sql`
      INSERT INTO dmo_live_broadcast_comments
        (broadcast_id, author_id, body, moderation_status, moderation_reason)
      VALUES
        (${id}::uuid, ${Number(user.id)}, ${text}, ${decision.status}, ${decision.reason})
      RETURNING id, created_at
    `;
    if (decision.status === 'pending') {
      await notifyForumAdminsForReview('A live chat message needs moderator review.', '/admin/moderation');
      return NextResponse.json(
        { pending: true, message: 'Your message is waiting for moderator review.' },
        { status: 202, headers: PRIVATE_HEADERS },
      );
    }
    return NextResponse.json({
      message: {
        id: String(rows[0].id),
        body: text,
        authorName: user.username,
        authorAvatar: user.avatar || null,
        createdAt: new Date(rows[0].created_at).toISOString(),
      },
    }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    console.error('[live-broadcast-chat] create failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Live chat is temporarily unavailable.' }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
