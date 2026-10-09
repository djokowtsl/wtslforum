import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { wtslCore } from '@/lib/wtsl-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const noStore = { 'cache-control': 'no-store, max-age=0' };

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: noStore });
  }

  try {
    const bets = await wtslCore.bets(user.discordId);
    if (!Array.isArray(bets)) throw new Error('Invalid Core ledger payload');
    return NextResponse.json({ bets }, { headers: noStore });
  } catch (error) {
    console.warn('[betting-ledger] Core ledger feed unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'betting_ledger_unavailable' },
      { status: 503, headers: noStore },
    );
  }
}
