import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getThread, markThreadRead, sendMessage } from '@/lib/messages';
import { safe } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const u = await getSession();
  if (!u) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { userId } = await params;
  const messages = await safe(() => getThread(u.id, userId), []);
  await safe(() => markThreadRead(u.id, userId), undefined);
  return NextResponse.json({ ok: true, messages });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const u = await getSession();
  if (!u) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { userId } = await params;
  const body = await req.json().catch(() => ({}));
  const text = String(body?.body ?? '').trim();
  if (!text) return NextResponse.json({ error: 'Message is empty' }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
  try {
    const message = await sendMessage(u.id, userId, text);
    return NextResponse.json({ ok: true, message });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to send message' }, { status: 400 });
  }
}
