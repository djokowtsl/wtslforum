import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { wtslCore } from '@/lib/wtsl-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const noStore = { 'cache-control': 'no-store, max-age=0' };

export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: noStore });
  }

  try {
    const [account, bets] = await Promise.all([
      wtslCore.balance(user.discordId),
      wtslCore.bets(user.discordId),
    ]);
    return NextResponse.json(
      { account, bets: Array.isArray(bets) ? bets : [] },
      { headers: noStore },
    );
  } catch (error) {
    console.warn('[betting-account] Core account feed unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'betting_account_unavailable' },
      { status: 503, headers: noStore },
    );
  }
}
