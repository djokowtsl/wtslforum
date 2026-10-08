import { NextRequest, NextResponse } from 'next/server';
import { syncPlayersAllTours } from '@/lib/tournaments';
import { isWtslSyncAuthorized } from '@/lib/wtslSyncAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Sync failed');

export async function GET(req: NextRequest) {
  if (!isWtslSyncAuthorized(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const players = await syncPlayersAllTours();
    const failed = players.some((result) => 'error' in result);
    return NextResponse.json({ ok: !failed, players }, { status: failed ? 500 : 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: msg(e) }, { status: 500 });
  }
}
