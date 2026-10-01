import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { searchMembers } from '@/lib/messages';
import { safe } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Backs the "New message" search box on the inbox page — finds other forum members by display
 * name so you can start a conversation without already knowing a profile link. */
export async function GET(req: NextRequest) {
  const u = await getSession();
  if (!u) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const q = req.nextUrl.searchParams.get('q') || '';
  const members = await safe(() => searchMembers(q, u.id), []);
  return NextResponse.json({ ok: true, members });
}
