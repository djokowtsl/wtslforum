import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { setDefaultPlayerClaim } from '@/lib/player-claims';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const claimId = String(body?.claimId ?? '').trim();
  if (!/^[1-9]\d*$/.test(claimId)) {
    return NextResponse.json({ error: 'Choose an approved WTSL identity.' }, { status: 400 });
  }
  const updated = await setDefaultPlayerClaim(user.id, claimId);
  if (!updated) return NextResponse.json({ error: 'That identity is not approved for your account.' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
