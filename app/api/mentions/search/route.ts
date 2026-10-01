import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { searchVerifiedMembers } from '@/lib/messages';
import { safe } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Backs the @mention autocomplete in the reply/topic composer — only verified players show up
 * here (see `searchVerifiedMembers`), so tagging is limited to real, confirmed WTSL identities. */
export async function GET(req: NextRequest) {
  const u = await getSession();
  if (!u) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const q = req.nextUrl.searchParams.get('q') || '';
  const members = await safe(() => searchVerifiedMembers(q, u.id), []);
  return NextResponse.json({ ok: true, members });
}
