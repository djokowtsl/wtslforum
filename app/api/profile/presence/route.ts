import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { recordPresenceActivity } from '@/lib/presence';

export const dynamic = 'force-dynamic';

export async function POST() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  await recordPresenceActivity(user.id);
  return NextResponse.json({ ok: true });
}