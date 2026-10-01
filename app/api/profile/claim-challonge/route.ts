import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { submitChallongeClaim } from '@/lib/challonge-claims';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const challongeUsername = String(body?.challonge_username ?? '').trim();
  const note = String(body?.note ?? '').trim().slice(0, 500);
  if (!challongeUsername) {
    return NextResponse.json({ error: 'Missing Challonge username' }, { status: 400 });
  }

  try {
    await submitChallongeClaim(user.id, challongeUsername, note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not submit claim' }, { status: 400 });
  }
}
