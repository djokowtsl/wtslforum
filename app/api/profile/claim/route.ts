import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { submitClaim } from '@/lib/player-claims';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const wtslPlayerId = String(body?.wtsl_player_id ?? '').trim();
  const tour = String(body?.tour ?? '').trim();
  const playerName = String(body?.player_name ?? '').trim();
  const note = String(body?.note ?? '').trim().slice(0, 500);
  if (!wtslPlayerId || !tour || !playerName) {
    return NextResponse.json({ error: 'Missing player, tour or player name' }, { status: 400 });
  }

  try {
    await submitClaim(user.id, wtslPlayerId, tour, playerName, note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not submit claim' }, { status: 400 });
  }
}
