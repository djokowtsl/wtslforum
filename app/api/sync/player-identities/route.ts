import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { PlayerIdentityConflictError } from '@/lib/player-claims';
import { syncDiscordApprovedIdentity, WtslPlayerLookupError } from '@/lib/matchlog-identity-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req: NextRequest) {
  const expected = (process.env.WTSL_SYNC_SECRET || '').trim();
  const supplied = (req.headers.get('x-wtsl-sync-secret') || '').trim();
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(supplied, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ status: 'retry', error: 'Unauthorized forum identity sync.' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const discordId = String(body?.discord_user_id ?? '').trim();
  const tour = String(body?.tour ?? '').trim().toLowerCase();
  const playerName = String(body?.player_name ?? '').trim();
  if (!/^[1-9]\d{0,19}$/.test(discordId) || !['atp', 'wta'].includes(tour) || !playerName || playerName.length > 200) {
    return NextResponse.json({ status: 'retry', error: 'Invalid Discord player identity payload.' }, { status: 400 });
  }
  try {
    const result = await syncDiscordApprovedIdentity(discordId, tour, playerName);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Identity sync failed.';
    if (error instanceof PlayerIdentityConflictError) {
      return NextResponse.json({ status: 'conflict', error: message, reason: message }, { status: 409 });
    }
    if (error instanceof WtslPlayerLookupError) {
      return NextResponse.json({ status: 'retry', error: message, reason: message }, { status: error.statusCode });
    }
    console.error('[wtsl] approved Discord identity sync failed', message);
    return NextResponse.json({ status: 'retry', error: 'Forum identity sync failed; retry later.' }, { status: 500 });
  }
}