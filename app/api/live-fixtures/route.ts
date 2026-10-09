import { NextResponse } from 'next/server';
import { fixturesBoard } from '@/lib/betting';
import { getTournaments } from '@/lib/tournaments';
import { safe } from '@/lib/db';
import {
  deduplicateBettingBoardFixtures,
  selectPublicOpenFixtures,
} from '@/lib/fixture-order';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const noStore = { 'cache-control': 'no-store, max-age=0' };

export async function GET() {
  try {
    const [board, atpTournaments, wtaTournaments] = await Promise.all([
      fixturesBoard(),
      safe(() => getTournaments('TE4'), [] as any[]),
      safe(() => getTournaments('TE4_(F)'), [] as any[]),
    ]);
    const tournaments = [...atpTournaments, ...wtaTournaments];
    const normalizedBoard = {
      open: Array.isArray(board?.open) ? board.open : [],
      recent_settled: Array.isArray(board?.recent_settled) ? board.recent_settled : [],
    };
    const bettingBoard = deduplicateBettingBoardFixtures(normalizedBoard, tournaments);

    return NextResponse.json(
      {
        bettingBoard,
        publicOpen: selectPublicOpenFixtures(normalizedBoard.open, tournaments),
      },
      { headers: noStore },
    );
  } catch (error) {
    console.error('[live-fixtures] Feed unavailable', {
      errorType: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'live_fixture_feed_unavailable' },
      { status: 503, headers: noStore },
    );
  }
}
