import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listConversations, sendMessage } from '@/lib/messages';
import { safe } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const u = await getSession();
  if (!u) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const conversations = await safe(() => listConversations(u.id), []);
  return NextResponse.json({ ok: true, conversations });
}

/** Starts a new conversation with { to, body }. Use /api/messages/[userId] to reply within one. */
export async function POST(req: NextRequest) {
  const u = await getSession();
  if (!u) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const to = Number(body?.to);
  const text = String(body?.body ?? '').trim();
  if (!to || !text) return NextResponse.json({ error: 'Missing recipient or message' }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
  try {
    const message = await sendMessage(u.id, to, text);
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to send message' }, { status: 400 });
  }
}
