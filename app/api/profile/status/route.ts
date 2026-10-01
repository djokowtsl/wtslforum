import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { setUserStatus, isUserStatus } from '@/lib/presence';

export async function POST(req: NextRequest) {
  const u = await getSession();
  if (!u) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!isUserStatus(body?.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  await setUserStatus(u.id, body.status);
  return NextResponse.json({ ok: true });
}
